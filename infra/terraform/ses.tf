resource "aws_ses_domain_identity" "root" {
  domain = var.hosted_zone_domain
}

resource "aws_ses_domain_dkim" "root" {
  domain = aws_ses_domain_identity.root.domain
}

resource "aws_route53_record" "ses_dkim" {
  count   = 3
  zone_id = data.aws_route53_zone.root.zone_id
  name    = "${aws_ses_domain_dkim.root.dkim_tokens[count.index]}._domainkey.${var.hosted_zone_domain}"
  type    = "CNAME"
  ttl     = "600"
  records = ["${aws_ses_domain_dkim.root.dkim_tokens[count.index]}.dkim.amazonses.com"]
}

resource "aws_ses_domain_mail_from" "root" {
  domain           = aws_ses_domain_identity.root.domain
  mail_from_domain = "mail.${var.hosted_zone_domain}"
}

resource "aws_route53_record" "ses_mail_from_mx" {
  zone_id = data.aws_route53_zone.root.zone_id
  name    = aws_ses_domain_mail_from.root.mail_from_domain
  type    = "MX"
  ttl     = "600"
  records = ["10 feedback-smtp.${var.aws_region}.amazonses.com"]
}

resource "aws_route53_record" "ses_mail_from_spf" {
  zone_id = data.aws_route53_zone.root.zone_id
  name    = aws_ses_domain_mail_from.root.mail_from_domain
  type    = "TXT"
  ttl     = "600"
  records = ["v=spf1 include:amazonses.com ~all"]
}

resource "aws_ses_configuration_set" "this" {
  name = "${local.name_prefix}-config"

  delivery_options {
    tls_policy = "Require"
  }
}

# ─── Wave 50 — transactional email pipeline ───────────────────────────────
#
# A second configuration set, dedicated to transactional sends, with
# reputation tracking ON and bounce/complaint/delivery events fanned out
# to two SNS topics. The webhook handler at
# /api/webhooks/ses-bounce-complaint subscribes to both topics and
# inserts ses_suppression_list rows on hard bounces / complaints.

resource "aws_sesv2_configuration_set" "harbor_transactional" {
  configuration_set_name = "${local.name_prefix}-transactional"

  delivery_options {
    tls_policy = "REQUIRE"
  }

  reputation_options {
    reputation_metrics_enabled = true
  }

  sending_options {
    sending_enabled = true
  }

  # Suppression at the AWS account level — any address that bounces or
  # complains anywhere in the account is auto-suppressed for 14d. This
  # is independent of our app-level ses_suppression_list table; both
  # work in concert.
  suppression_options {
    suppressed_reasons = ["BOUNCE", "COMPLAINT"]
  }
}

resource "aws_sns_topic" "ses_bounces" {
  name = "${local.name_prefix}-ses-bounces"
}

resource "aws_sns_topic" "ses_complaints" {
  name = "${local.name_prefix}-ses-complaints"
}

resource "aws_sns_topic" "ses_deliveries" {
  name = "${local.name_prefix}-ses-deliveries"
}

resource "aws_sesv2_configuration_set_event_destination" "bounces" {
  configuration_set_name = aws_sesv2_configuration_set.harbor_transactional.configuration_set_name
  event_destination_name = "bounces-to-sns"

  event_destination {
    enabled              = true
    matching_event_types = ["BOUNCE"]

    sns_destination {
      topic_arn = aws_sns_topic.ses_bounces.arn
    }
  }
}

resource "aws_sesv2_configuration_set_event_destination" "complaints" {
  configuration_set_name = aws_sesv2_configuration_set.harbor_transactional.configuration_set_name
  event_destination_name = "complaints-to-sns"

  event_destination {
    enabled              = true
    matching_event_types = ["COMPLAINT"]

    sns_destination {
      topic_arn = aws_sns_topic.ses_complaints.arn
    }
  }
}

resource "aws_sesv2_configuration_set_event_destination" "deliveries" {
  configuration_set_name = aws_sesv2_configuration_set.harbor_transactional.configuration_set_name
  event_destination_name = "deliveries-to-sns"

  event_destination {
    enabled              = true
    matching_event_types = ["DELIVERY"]

    sns_destination {
      topic_arn = aws_sns_topic.ses_deliveries.arn
    }
  }
}

resource "aws_sns_topic_subscription" "ses_bounces_to_app" {
  topic_arn              = aws_sns_topic.ses_bounces.arn
  protocol               = "https"
  endpoint               = "https://${coalesce(var.app_fqdn_override, var.hosted_zone_domain)}/api/webhooks/ses-bounce-complaint"
  endpoint_auto_confirms = true
  raw_message_delivery   = false
}

resource "aws_sns_topic_subscription" "ses_complaints_to_app" {
  topic_arn              = aws_sns_topic.ses_complaints.arn
  protocol               = "https"
  endpoint               = "https://${coalesce(var.app_fqdn_override, var.hosted_zone_domain)}/api/webhooks/ses-bounce-complaint"
  endpoint_auto_confirms = true
  raw_message_delivery   = false
}

resource "aws_sns_topic_subscription" "ses_deliveries_to_app" {
  topic_arn              = aws_sns_topic.ses_deliveries.arn
  protocol               = "https"
  endpoint               = "https://${coalesce(var.app_fqdn_override, var.hosted_zone_domain)}/api/webhooks/ses-bounce-complaint"
  endpoint_auto_confirms = true
  raw_message_delivery   = false
}

output "ses_transactional_configuration_set_name" {
  value       = aws_sesv2_configuration_set.harbor_transactional.configuration_set_name
  description = "Pass this as SES_CONFIGURATION_SET to the Next.js app."
}

output "ses_sns_topic_arns" {
  value = join(",", [
    aws_sns_topic.ses_bounces.arn,
    aws_sns_topic.ses_complaints.arn,
    aws_sns_topic.ses_deliveries.arn,
  ])
  description = "Pass this as SES_SNS_TOPIC_ARNS to the Next.js app for webhook allowlisting."
}
