terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  backend "s3" {
    # Configure with `terraform init -backend-config=backend.hcl`
    # Example backend.hcl:
    #   bucket         = "harbor-terraform-state-417242953135"
    #   key            = "staging/terraform.tfstate"
    #   region         = "us-east-1"
    #   dynamodb_table = "harbor-terraform-lock"
    #   encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "harbor"
      Environment = var.environment
      ManagedBy   = "terraform"
      Stack       = "aws-v1"
      Compliance  = "hipaa"
    }
  }
}

# Provider aliased for us-east-1 (required for ACM certs attached to CloudFront,
# and convenient even when primary region is us-east-1).
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "harbor"
      Environment = var.environment
      ManagedBy   = "terraform"
      Stack       = "aws-v1"
      Compliance  = "hipaa"
    }
  }
}
