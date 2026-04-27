output "app_url" {
  description = "Public URL of the staging app."
  value       = "https://${local.app_fqdn}"
}

output "rds_endpoint" {
  description = "RDS endpoint (use via VPN / bastion only)."
  value       = aws_db_instance.primary.address
}

output "rds_port" {
  value = aws_db_instance.primary.port
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "ecs_service_name" {
  value = aws_ecs_service.app.name
}

output "ecr_app_repo_url" {
  value = aws_ecr_repository.app.repository_url
}

output "ecr_voice_server_repo_url" {
  value = aws_ecr_repository.voice_server.repository_url
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "cognito_user_pool_client_id" {
  value = aws_cognito_user_pool_client.app.id
}

output "cognito_issuer" {
  value = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.this.id}"
}

output "s3_uploads_bucket" {
  value = aws_s3_bucket.uploads.bucket
}

output "ses_from_domain" {
  value = aws_ses_domain_identity.root.domain
}

output "alerts_sns_topic_arn" {
  description = "SNS topic that receives all CloudWatch alarms. Subscribe additional endpoints to it (Slack/PagerDuty/etc.) without re-running terraform."
  value       = aws_sns_topic.alerts.arn
}
