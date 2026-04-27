# S3 bucket for PHI export ZIPs (per-patient and per-practice).
#
# Created for the PHI export feature (HIPAA right-of-portability + practice
# decommission preservation). Objects are short-lived: presigned download URLs
# are valid 24h, and lifecycle expiry deletes objects after 7 days regardless.
#
# Encryption: customer-managed KMS (reusing the existing alias/${name}-s3 key).
# Access: ECS task role only — no public access, no other principals.

resource "aws_s3_bucket" "phi_exports" {
  bucket        = "harbor-staging-phi-exports-${data.aws_caller_identity.current.account_id}"
  force_destroy = var.environment != "production"
  tags          = merge(local.common_tags, { Purpose = "phi-exports" })
}

resource "aws_s3_bucket_public_access_block" "phi_exports" {
  bucket                  = aws_s3_bucket.phi_exports.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Versioning explicitly disabled — these are short-lived export artifacts and
# we don't want lingering historical PHI copies.
resource "aws_s3_bucket_versioning" "phi_exports" {
  bucket = aws_s3_bucket.phi_exports.id
  versioning_configuration {
    status = "Disabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "phi_exports" {
  bucket = aws_s3_bucket.phi_exports.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
    bucket_key_enabled = true
  }
}

# Hard expiry at 7 days. Presigned URLs are 24h; the extra cushion covers slow
# downloads and admin retries. After 7 days the object is gone.
resource "aws_s3_bucket_lifecycle_configuration" "phi_exports" {
  bucket = aws_s3_bucket.phi_exports.id

  rule {
    id     = "expire-phi-exports-7d"
    status = "Enabled"

    filter {}

    expiration {
      days = 7
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# Bucket policy: only the ECS task role may read/write. Deny everything else,
# including non-TLS access.
data "aws_iam_policy_document" "phi_exports_bucket" {
  statement {
    sid    = "AllowEcsTaskRoleOnly"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.phi_exports.arn,
      "${aws_s3_bucket.phi_exports.arn}/*",
    ]
    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.task.arn]
    }
  }

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [
      aws_s3_bucket.phi_exports.arn,
      "${aws_s3_bucket.phi_exports.arn}/*",
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "phi_exports" {
  bucket = aws_s3_bucket.phi_exports.id
  policy = data.aws_iam_policy_document.phi_exports_bucket.json
}

# Grant the ECS task role access to the new bucket. Kept as a separate policy
# rather than extending task_s3 in iam.tf so this feature is self-contained
# and easy to revert.
resource "aws_iam_role_policy" "task_phi_exports" {
  name = "${local.name_prefix}-task-phi-exports"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket",
      ]
      Resource = [
        aws_s3_bucket.phi_exports.arn,
        "${aws_s3_bucket.phi_exports.arn}/*",
      ]
    }]
  })
}

output "phi_exports_bucket" {
  value       = aws_s3_bucket.phi_exports.bucket
  description = "S3 bucket holding generated PHI export ZIPs (KMS-encrypted, 7-day lifecycle)."
}
