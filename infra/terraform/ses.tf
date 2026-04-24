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
