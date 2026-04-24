locals {
  name_prefix = "${var.project}-${var.environment}"

  # App runs at the hosted zone apex unless explicitly overridden.
  app_fqdn = var.app_fqdn_override != "" ? var.app_fqdn_override : var.hosted_zone_domain

  common_tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
    Stack       = "aws-v1"
    Compliance  = "hipaa"
  }
}

# Fetch the list of availability zones in the current region.
data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
