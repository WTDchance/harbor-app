resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.name_prefix}/app"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.logs.arn
  tags              = local.common_tags
}

resource "aws_ecs_cluster" "this" {
  name = local.name_prefix

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = local.common_tags
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }
}

locals {
  app_env = [
    { name = "NODE_ENV", value = var.environment == "production" ? "production" : "staging" },
    { name = "AWS_REGION", value = var.aws_region },
    { name = "APP_URL", value = "https://${local.app_fqdn}" },
    { name = "PGHOST", value = aws_db_instance.primary.address },
    { name = "PGPORT", value = tostring(aws_db_instance.primary.port) },
    { name = "PGDATABASE", value = var.rds_database_name },
    { name = "PGUSER", value = var.rds_master_username },
    { name = "PGSSLMODE", value = "require" },
    { name = "COGNITO_USER_POOL_ID", value = aws_cognito_user_pool.this.id },
    { name = "COGNITO_REGION", value = var.aws_region },
    { name = "COGNITO_DOMAIN", value = aws_cognito_user_pool_domain.this.domain },
    { name = "COGNITO_REDIRECT_URI", value = "https://${local.app_fqdn}/api/auth/callback" },
    { name = "COGNITO_APP_CLIENT_ID", value = aws_cognito_user_pool_client.app.id },
    { name = "COGNITO_CLIENT_ID", value = aws_cognito_user_pool_client.app.id },
    { name = "S3_UPLOADS_BUCKET", value = aws_s3_bucket.uploads.bucket },
    { name = "S3_TRANSCRIBE_UPLOADS_BUCKET", value = aws_s3_bucket.transcribe_uploads.bucket },
    { name = "SES_FROM_ADDRESS", value = var.ses_from_address },
    { name = "BEDROCK_HAIKU_MODEL", value = "us.anthropic.claude-haiku-4-5-v1:0" },
    { name = "BEDROCK_SONNET_MODEL", value = "us.anthropic.claude-sonnet-4-6-v1:0" },
  ]

  app_secrets = [
    { name = "PGPASSWORD",        valueFrom = aws_ssm_parameter.rds_password.arn },
    # Runtime API keys (see secrets.tf for the placeholder/ignore_changes pattern).
    { name = "ANTHROPIC_API_KEY", valueFrom = aws_ssm_parameter.anthropic_api_key.arn },
    { name = "STEDI_API_KEY",     valueFrom = aws_ssm_parameter.stedi_api_key.arn },
    { name = "OPENAI_API_KEY",    valueFrom = aws_ssm_parameter.openai_api_key.arn },
    # Stripe webhook signing secrets (Wave 25). Two distinct endpoints:
    #   subscriptions  → app/api/stripe/webhook/route.ts
    #   billing        → app/api/ehr/billing/stripe-webhook/route.ts
    { name = "STRIPE_WEBHOOK_SECRET",     valueFrom = aws_ssm_parameter.stripe_webhook_subscriptions.arn },
    { name = "STRIPE_EHR_WEBHOOK_SECRET", valueFrom = aws_ssm_parameter.stripe_webhook_billing.arn },
    # Wave 27b — SignalWire + Retell carrier-swap credentials.
    { name = "SIGNALWIRE_PROJECT_ID",     valueFrom = aws_ssm_parameter.signalwire_project_id.arn },
    { name = "SIGNALWIRE_TOKEN",          valueFrom = aws_ssm_parameter.signalwire_token.arn },
    { name = "SIGNALWIRE_SPACE_URL",      valueFrom = aws_ssm_parameter.signalwire_space_url.arn },
    { name = "SIGNALWIRE_FROM_NUMBER",    valueFrom = aws_ssm_parameter.signalwire_from_number.arn },
    { name = "RETELL_API_KEY",            valueFrom = aws_ssm_parameter.retell_api_key.arn },
    { name = "RETELL_AGENT_ID",           valueFrom = aws_ssm_parameter.retell_agent_id.arn },
    { name = "RETELL_LLM_ID",             valueFrom = aws_ssm_parameter.retell_llm_id.arn },
    # Wave 27p — LaML signing key (HMAC key for inbound webhook signature).
    { name = "SIGNALWIRE_SIGNING_KEY",    valueFrom = aws_ssm_parameter.signalwire_signing_key.arn },
    # Wave 27o — debug toggle ("true"/"false"). Plain String SSM param.
    { name = "SIGNALWIRE_VALIDATE_INBOUND", valueFrom = aws_ssm_parameter.signalwire_validate_inbound.arn },
  ]
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${local.name_prefix}-app"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = tostring(var.app_cpu)
  memory                   = tostring(var.app_memory)
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name      = "app"
    image     = "${aws_ecr_repository.app.repository_url}:${var.app_image_tag}"
    essential = true

    portMappings = [{
      containerPort = var.app_container_port
      protocol      = "tcp"
    }]

    environment = local.app_env
    secrets     = local.app_secrets

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "app"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:${var.app_container_port}/api/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])

  tags = local.common_tags
}

resource "aws_ecs_service" "app" {
  name                               = "${local.name_prefix}-app"
  cluster                            = aws_ecs_cluster.this.id
  task_definition                    = aws_ecs_task_definition.app.arn
  desired_count                      = var.app_desired_count
  launch_type                        = "FARGATE"
  platform_version                   = "LATEST"
  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60

  network_configuration {
    subnets          = aws_subnet.private_app[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = var.app_container_port
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # Let the CI/CD pipeline bump the task def; Terraform only declares the initial shape.
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  depends_on = [aws_lb_listener.https]

  tags = local.common_tags
}

# ---- Auto-scaling (CPU-based) ----
resource "aws_appautoscaling_target" "app" {
  max_capacity       = 10
  min_capacity       = var.app_desired_count
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.app.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "app_cpu" {
  name               = "${local.name_prefix}-app-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.app.resource_id
  scalable_dimension = aws_appautoscaling_target.app.scalable_dimension
  service_namespace  = aws_appautoscaling_target.app.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 60
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
