# RDS Postgres for Harbor. Replaces Supabase - only the database, not auth.
# Cognito takes over auth (see cognito.tf).

resource "random_password" "rds_master" {
  length           = 40
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>?"
}

resource "aws_ssm_parameter" "rds_password" {
  name        = "/${local.name_prefix}/rds/master_password"
  description = "Master password for Harbor RDS. Rotate via secretsmanager or manual ops."
  type        = "SecureString"
  value       = random_password.rds_master.result
  key_id      = aws_kms_key.ssm.arn
  tags        = local.common_tags
}

resource "aws_ssm_parameter" "rds_username" {
  name  = "/${local.name_prefix}/rds/master_username"
  type  = "String"
  value = var.rds_master_username
  tags  = local.common_tags
}

resource "aws_db_subnet_group" "this" {
  name       = "${local.name_prefix}-rds"
  subnet_ids = aws_subnet.private_data[*].id
  tags       = local.common_tags
}

resource "aws_db_parameter_group" "this" {
  name        = "${local.name_prefix}-pg16"
  family      = "postgres16"
  description = "Harbor RDS parameter group - force SSL, log slow queries."

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "500" # log anything slower than 500ms
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  tags = local.common_tags
}

resource "aws_db_instance" "primary" {
  identifier     = "${local.name_prefix}-pg"
  engine         = "postgres"
  engine_version = var.rds_engine_version
  instance_class = var.rds_instance_class

  allocated_storage     = var.rds_allocated_storage_gb
  max_allocated_storage = var.rds_max_allocated_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.rds.arn

  db_name  = var.rds_database_name
  username = var.rds_master_username
  password = random_password.rds_master.result
  port     = 5432

  multi_az               = var.rds_multi_az
  publicly_accessible    = false
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  parameter_group_name   = aws_db_parameter_group.this.name

  backup_retention_period = var.rds_backup_retention_days
  backup_window           = "07:00-08:00" # UTC - 11pm-midnight Pacific
  maintenance_window      = "Sun:08:00-Sun:09:00"
  copy_tags_to_snapshot   = true

  deletion_protection       = var.environment == "production"
  skip_final_snapshot       = var.environment != "production"
  final_snapshot_identifier = var.environment == "production" ? "${local.name_prefix}-final-${formatdate("YYYYMMDD-hhmmss", timestamp())}" : null

  enabled_cloudwatch_logs_exports       = ["postgresql"]
  performance_insights_enabled          = true
  performance_insights_kms_key_id       = aws_kms_key.rds.arn
  performance_insights_retention_period = 7

  auto_minor_version_upgrade = true
  apply_immediately          = false

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-pg" })

  lifecycle {
    ignore_changes = [password] # rotate via SSM + manual apply
  }
}
