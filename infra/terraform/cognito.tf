# Cognito User Pool replaces Supabase auth. Token verification in-app uses
# `aws-jwt-verify` against the pool's JWKs endpoint.
#
# Wave 39 / Task 5 — email_configuration uses SES with branded
# verification + invite templates. Forgot-password emails are NOT
# customized here: Cognito only allows custom forgot-password copy via
# a CustomMessage Lambda trigger (event.triggerSource ===
# 'CustomMessage_ForgotPassword'). Wiring that Lambda is a follow-up
# task (Lambda IAM + code + deployment package + lambda_config block
# below). Until then, password-reset emails use the Cognito default
# but are still SOURCED from SES (not Cognito's low-volume sender).

resource "aws_cognito_user_pool" "this" {
  name = "${local.name_prefix}-users"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 3
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false

    invite_message_template {
      email_subject = "You're invited to Harbor"
      email_message = <<-EOT
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f0;margin:0;padding:20px;color:#1f2937;">
  <div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#0d9488;padding:24px 32px;color:white;">
      <h1 style="margin:0;font-size:20px;font-weight:600;">You're invited to Harbor</h1>
    </div>
    <div style="padding:32px;font-size:15px;line-height:1.7;">
      <p>An admin at your practice created a Harbor account for you.</p>
      <p><strong>Your username:</strong> {username}<br/><strong>Temporary password:</strong> {####}</p>
      <p>Sign in at <a href="https://harborreceptionist.com/login" style="color:#0d9488;">harborreceptionist.com/login</a> and you'll be prompted to choose a permanent password right away.</p>
      <p style="font-size:13px;color:#6b7280;">If you weren't expecting this, please contact your practice admin.</p>
    </div>
    <div style="padding:18px 32px;background:#f9f9f7;font-size:12px;color:#999;text-align:center;">Harbor — AI Receptionist for Therapy Practices</div>
  </div>
</body></html>
      EOT
      sms_message   = "Your Harbor temporary password is {####}. Sign in at harborreceptionist.com/login as {username}."
    }
  }

  # Wave 39 / Task 5 — branded email templates routed through SES.
  # email_sending_account = DEVELOPER means Cognito sends via SES using
  # the configured from_email_address (must be a verified identity, set
  # up by infra/terraform/ses.tf). Cognito's default low-volume sender
  # is replaced.
  email_configuration {
    email_sending_account  = "DEVELOPER"
    from_email_address     = var.ses_from_address
    source_arn             = aws_ses_domain_identity.root.arn
    reply_to_email_address = var.ses_from_address
    # NOTE: configuration_set_name is intentionally omitted — wiring the
    # Wave 27 SES configuration set is a separate hardening pass.
  }

  # Branded verification email — sent on signup. {####} interpolates to
  # the 6-digit code Cognito generates. {username} is intentionally omitted
  # from the body because Cognito stores the email-as-username and surfacing
  # the literal email in HTML is needless duplication.
  email_verification_subject = "Verify your Harbor account"
  email_verification_message = <<-EOT
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f0;margin:0;padding:20px;color:#1f2937;">
  <div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#0d9488;padding:24px 32px;color:white;">
      <h1 style="margin:0;font-size:20px;font-weight:600;">Verify your Harbor account</h1>
    </div>
    <div style="padding:32px;font-size:15px;line-height:1.7;">
      <p>Welcome to Harbor.</p>
      <p>Use this code to finish setting up your account:</p>
      <p style="text-align:center;font-size:30px;font-weight:700;color:#0d9488;letter-spacing:6px;margin:24px 0;">{####}</p>
      <p style="font-size:13px;color:#6b7280;">If you didn't create a Harbor account, you can safely ignore this email.</p>
    </div>
    <div style="padding:18px 32px;background:#f9f9f7;font-size:12px;color:#999;text-align:center;">Harbor — AI Receptionist for Therapy Practices</div>
  </div>
</body></html>
  EOT

  # SMS verification body — kept short and code-focused. {####} same.
  sms_verification_message = "Your Harbor verification code is {####}"

  schema {
    name                     = "email"
    attribute_data_type      = "String"
    required                 = true
    mutable                  = true
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 5
      max_length = 2048
    }
  }

  schema {
    name                     = "practice_id"
    attribute_data_type      = "String"
    mutable                  = true
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 36
      max_length = 36
    }
  }

  schema {
    name                     = "role"
    attribute_data_type      = "String"
    mutable                  = true
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 1
      max_length = 32
    }
  }

  mfa_configuration = "OPTIONAL"

  software_token_mfa_configuration {
    enabled = true
  }

  user_pool_add_ons {
    advanced_security_mode = "AUDIT"
  }

  tags = local.common_tags
}

resource "aws_cognito_user_pool_client" "app" {
  name         = "${local.name_prefix}-app"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
  ]

  prevent_user_existence_errors = "ENABLED"

  access_token_validity  = 60 # minutes
  id_token_validity      = 60 # minutes
  refresh_token_validity = 30 # days

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  supported_identity_providers = ["COGNITO"]
  callback_urls                = ["https://${local.app_fqdn}/api/auth/callback"]
  logout_urls                  = ["https://${local.app_fqdn}/login"]

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  allowed_oauth_flows_user_pool_client = true
}

resource "aws_cognito_user_pool_domain" "this" {
  domain       = "${local.name_prefix}-auth"
  user_pool_id = aws_cognito_user_pool.this.id
}
