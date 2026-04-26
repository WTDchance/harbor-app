# SSM SecureString parameters for runtime API keys consumed by the ECS app.
#
# Pattern: terraform creates the resource with a placeholder value but
# uses lifecycle.ignore_changes = [value] so the real secret can be set
# (and rotated) via `aws ssm put-parameter --overwrite` without terraform
# fighting it.
#
# Set values after `terraform apply` with, e.g.:
#   aws ssm put-parameter \
#     --name /harbor-staging/api-keys/anthropic \
#     --type SecureString \
#     --key-id <ssm KMS key ARN> \
#     --overwrite \
#     --value "$ANTHROPIC_API_KEY"
#
# Task IAM (infra/terraform/iam.tf::task_ssm_runtime) already grants
# ssm:GetParameter + kms:Decrypt for everything under /${name_prefix}/*,
# so no additional IAM is needed.

locals {
  api_key_placeholder = "PLACEHOLDER-set-via-aws-ssm-put-parameter"
}

resource "aws_ssm_parameter" "anthropic_api_key" {
  name        = "/${local.name_prefix}/api-keys/anthropic"
  description = "Anthropic API key — used by EHR draft routes (claude-sonnet-4-6)."
  type        = "SecureString"
  value       = local.api_key_placeholder
  key_id      = aws_kms_key.ssm.arn
  tags        = local.common_tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "stedi_api_key" {
  name        = "/${local.name_prefix}/api-keys/stedi"
  description = "Stedi API key — used by /api/cron/ehr-era-poll for 835 ERA reconciliation."
  type        = "SecureString"
  value       = local.api_key_placeholder
  key_id      = aws_kms_key.ssm.arn
  tags        = local.common_tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "openai_api_key" {
  name        = "/${local.name_prefix}/api-keys/openai"
  description = "OpenAI API key — used by /api/ehr/notes/transcribe (Whisper voice dictation fallback)."
  type        = "SecureString"
  value       = local.api_key_placeholder
  key_id      = aws_kms_key.ssm.arn
  tags        = local.common_tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "stripe_webhook_subscriptions" {
  name        = "/${local.name_prefix}/api-keys/stripe-webhook-subscriptions"
  description = "Stripe signing secret for the subscription/checkout endpoint — consumed by app/api/stripe/webhook (Wave 15)."
  type        = "SecureString"
  value       = local.api_key_placeholder
  key_id      = aws_kms_key.ssm.arn
  tags        = local.common_tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "stripe_webhook_billing" {
  name        = "/${local.name_prefix}/api-keys/stripe-webhook-billing"
  description = "Stripe signing secret for the EHR-billing endpoint — consumed by app/api/ehr/billing/stripe-webhook (Wave 15)."
  type        = "SecureString"
  value       = local.api_key_placeholder
  key_id      = aws_kms_key.ssm.arn
  tags        = local.common_tags

  lifecycle {
    ignore_changes = [value]
  }
}
