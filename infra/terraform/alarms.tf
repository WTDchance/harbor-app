# -----------------------------------------------------------------------------
# CloudWatch alarms + SNS notification topic.
# Tier-1 operational readiness (T1.4). Five alarms cover the failure modes
# we'd most want a 2 AM page for: app process death, ALB error spike, DB
# CPU saturation, DB storage exhaustion, ECS task memory pressure.
#
# Subscribe with an email after `terraform apply`:
#   aws sns subscribe \
#     --topic-arn $(terraform output -raw alerts_sns_topic_arn) \
#     --protocol email \
#     --notification-endpoint chancewonser@gmail.com
#   # then confirm via the AWS confirmation email.
# -----------------------------------------------------------------------------

resource "aws_sns_topic" "alerts" {
  name              = "${local.name_prefix}-alerts"
  kms_master_key_id = aws_kms_key.logs.id
  tags              = local.common_tags
}

resource "aws_sns_topic_subscription" "alerts_email" {
  count                  = var.alert_email == "" ? 0 : 1
  topic_arn              = aws_sns_topic.alerts.arn
  protocol               = "email"
  endpoint               = var.alert_email
  endpoint_auto_confirms = false
}

# 1. ECS service running task count below desired.
resource "aws_cloudwatch_metric_alarm" "ecs_running_below_desired" {
  alarm_name          = "${local.name_prefix}-ecs-running-below-desired"
  alarm_description   = "ECS service running fewer tasks than desired for 2+ datapoints. App is partially or fully down."
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 60
  statistic           = "Minimum"
  threshold           = var.app_desired_count
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    ClusterName = aws_ecs_cluster.this.name
    ServiceName = aws_ecs_service.app.name
  }
  tags = local.common_tags
}

# 2. ALB 5xx rate > 1% over 5 min.
resource "aws_cloudwatch_metric_alarm" "alb_5xx_rate" {
  alarm_name          = "${local.name_prefix}-alb-5xx-rate"
  alarm_description   = "ALB target 5xx rate exceeded 1% over 5 minutes. Likely an app regression or a downstream outage."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0.01
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "rate"
    expression  = "IF(requests > 0, fivexx / requests, 0)"
    label       = "5xx rate"
    return_data = true
  }
  metric_query {
    id = "fivexx"
    metric {
      metric_name = "HTTPCode_Target_5XX_Count"
      namespace   = "AWS/ApplicationELB"
      period      = 300
      stat        = "Sum"
      dimensions  = { LoadBalancer = aws_lb.app.arn_suffix }
    }
  }
  metric_query {
    id = "requests"
    metric {
      metric_name = "RequestCount"
      namespace   = "AWS/ApplicationELB"
      period      = 300
      stat        = "Sum"
      dimensions  = { LoadBalancer = aws_lb.app.arn_suffix }
    }
  }

  tags = local.common_tags
}

# 3. RDS CPU > 80% for 10 min.
resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  alarm_name          = "${local.name_prefix}-rds-cpu-high"
  alarm_description   = "RDS CPU above 80% for 10 minutes. Investigate slow queries or scale up the instance class."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.primary.identifier
  }
  tags = local.common_tags
}

# 4. RDS free storage < 10% of allocated.
resource "aws_cloudwatch_metric_alarm" "rds_storage_low" {
  alarm_name          = "${local.name_prefix}-rds-storage-low"
  alarm_description   = "RDS free storage dropped below 10% of allocated. Storage autoscaling has a lag — bump rds_max_allocated_storage_gb if needed."
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Minimum"
  # 10% of allocated, in bytes (var is in GB).
  threshold           = var.rds_allocated_storage_gb * 1024 * 1024 * 1024 * 0.1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.primary.identifier
  }
  tags = local.common_tags
}

# 5. ECS task memory > 85% (Container Insights service-level metric).
resource "aws_cloudwatch_metric_alarm" "ecs_memory_high" {
  alarm_name          = "${local.name_prefix}-ecs-memory-high"
  alarm_description   = "ECS service memory utilization above 85% for 10 minutes. Bump task memory or investigate a leak."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 85
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    ClusterName = aws_ecs_cluster.this.name
    ServiceName = aws_ecs_service.app.name
  }
  tags = local.common_tags
}
