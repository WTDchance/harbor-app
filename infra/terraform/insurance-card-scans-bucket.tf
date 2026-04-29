# S3 bucket for insurance-card scan originals (front/back JPEGs).
#
# Therapist taps "Update from card" on a phone, snaps the front + back of the
# patient's insurance card, the API route uploads the originals here, then
# calls Textract AnalyzeDocument with FeatureTypes=['FORMS'] to extract member
# ID / group / payer / RX BIN etc. The parsed values are written back to the
# patient row's insurance_* columns; the originals stay here for audit and
# re-parse.
#
# HIPAA notes:
#   * KMS-encrypted with the existing aws_kms_key.s3 (one-key-per-domain
#     pattern from kms.tf).
#   * Public access fully blocked, non-TLS access denied at the bucket policy.
#   * Versioning OFF — re-scans create new object keys, we don't want stale
#     PHI versions piling up.
#   * Lifecycle: 90 days hot then transition to Glacier. Originals are kept
#     forever (no expiration) — the parsed scan_data row in
#     ehr_insurance_card_scans references the key.
#   * Textract is HIPAA-eligible under the existing AWS BAA. No image bytes
#     leave AWS.

resource "aws_s3_bucket" "insurance_cards" {
  bucket        = "harbor-staging-insurance-cards-${data.aws_caller_identity.current.account_id}"
  force_destroy = var.environment != "production"
  tags          = merge(local.common_tags, { Purpose = "insurance-card-scans" })
}

resource "aws_s3_bucket_public_access_block" "insurance_cards" {
  bucket                  = aws_s3_bucket.insurance_cards.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Versioning explicitly disabled — re-scans create new (scan_id) prefixes so
# we don't need historical versions of the same key.
resource "aws_s3_bucket_versioning" "insurance_cards" {
  bucket = aws_s3_bucket.insurance_cards.id
  versioning_configuration {
    status = "Disabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "insurance_cards" {
  bucket = aws_s3_bucket.insurance_cards.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
    bucket_key_enabled = true
  }
}

# 90 days hot, then Glacier. Originals are valuable for audit + re-parse but
# rarely accessed after the first few weeks.
resource "aws_s3_bucket_lifecycle_configuration" "insurance_cards" {
  bucket = aws_s3_bucket.insurance_cards.id

  rule {
    id     = "transition-insurance-cards-glacier-90d"
    status = "Enabled"

    filter {}

    transition {
      days          = 90
      storage_class = "GLACIER"
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# Bucket policy: only the ECS task role may read/write. Deny everything else,
# including non-TLS access.
data "aws_iam_policy_document" "insurance_cards_bucket" {
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
      aws_s3_bucket.insurance_cards.arn,
      "${aws_s3_bucket.insurance_cards.arn}/*",
    ]
    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.task.arn]
    }
  }

  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.insurance_cards.arn,
      "${aws_s3_bucket.insurance_cards.arn}/*",
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

resource "aws_s3_bucket_policy" "insurance_cards" {
  bucket = aws_s3_bucket.insurance_cards.id
  policy = data.aws_iam_policy_document.insurance_cards_bucket.json
}

# Grant the ECS task role:
#   * S3 PutObject/GetObject/DeleteObject on the bucket
#   * Textract AnalyzeDocument + AnalyzeID
#
# AnalyzeID is provided for completeness (govt IDs, e.g. driver's license
# scans for ID verification) — the insurance-card route itself uses
# AnalyzeDocument with FeatureTypes=['FORMS'] since insurance cards are
# not in Textract's AnalyzeID-supported document set.
resource "aws_iam_role_policy" "task_insurance_cards" {
  name = "${local.name_prefix}-task-insurance-cards"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:ListBucket",
        ]
        Resource = [
          aws_s3_bucket.insurance_cards.arn,
          "${aws_s3_bucket.insurance_cards.arn}/*",
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "textract:DetectDocumentText",
          "textract:AnalyzeDocument",
          "textract:AnalyzeID",
        ]
        Resource = "*"
      },
    ]
  })
}

output "insurance_cards_bucket" {
  value       = aws_s3_bucket.insurance_cards.bucket
  description = "S3 bucket holding insurance-card scan originals (KMS-encrypted, 90d-then-Glacier)."
}
