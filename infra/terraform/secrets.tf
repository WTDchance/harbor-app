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

# -----------------------------------------------------------------------------
# Wave 27b — SignalWire + Retell carrier-swap credentials.
# -----------------------------------------------------------------------------
# These replace the legacy Twilio + Vapi values. Same SSM placeholder pattern
# as the rest of secrets.tf so terraform doesn't fight the rotated secret
# values. Note: SignalWire project_id, space URL, from-number and the Retell
# agent/llm IDs are not "secrets" in the strict sense (they appear in API
# call URLs and dashboards), but we keep them in SSM-via-secrets for
# consistency with the rest of the carrier config and so rotation has a
# single audit surface.

resource "aws_ssm_parameter" "signalwire_project_id" {
  name        = "/${local.name_prefix}/api-keys/signalwire-project-id"
  description = "SignalWire project ID — half of the basic-auth credential pair for the SignalWire LaML/REST API."
  type        = "SecureString"
  value       = local.api_key_placeholder
  key_id      = aws_kms_key.ssm.arn
  tags        = local.common_tags
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "signalwire_token" {
  name        = "/${local.name_prefix}/api-keys/signalwire-token"
  description = "SignalWire project token — secret half of basic-auth, used to call the LaML messaging endpoint."
  type        = "SecureString"
  value       = local.api_key_placeholder
  key_id      = aws_kms_key.ssm.arn
  tags        = local.common_tags
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "signalwire_space_url" {
  name        = "/${local.name_prefix}/api-keys/signalwire-space-url"
  description = "SignalWire space URL host (e.g. harborreceptionist-com.signalwire.com)."
  type        = "SecureString"
  value       = local.api_key_placeholder
  key_id      = aws_kms_key.ssm.arn
  tags        = local.common_tags
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "signalwire_from_number" {
  name        = "/${local.name_prefix}/api-keys/signalwire-from-number"
  description = "Default outbound SignalWire phone number (E.164) used for SMS sends."
  type        = "SecureString"
  value       = local.api_key_placeholder
  key_id      = aws_kms_key.ssm.arn
  tags        = local.common_tags
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "retell_api_key" {
  name        = "/${local.name_prefix}/api-keys/retell"
  description = "Retell API key — used to register inbound calls + manage agent config from the app."
  type        = "SecureString"
  value       = local.api_key_placeholder
  key_id      = aws_kms_key.ssm.arn
  tags        = local.common_tags
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "retell_agent_id" {
  name        = "/${local.name_prefix}/api-keys/retell-agent-id"
  description = "Retell agent_id for the Harbor Receptionist (Wave 27a). Used by the inbound-call register handler + tool-route auth gate."
  type        = "SecureString"
  value       = local.api_key_placeholder
  key_id      = aws_kms_key.ssm.arn
  tags        = local.common_tags
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "retell_llm_id" {
  name        = "/${local.name_prefix}/api-keys/retell-llm-id"
  description = "Retell llm_id backing the Harbor Receptionist agent. Used by ops scripts that PATCH the LLM (e.g. tool URL refresh)."
  type        = "SecureString"
  value       = local.api_key_placeholder
  key_id      = aws_kms_key.ssm.arn
  tags        = local.common_tags
  lifecycle { ignore_changes = [value] }
}
