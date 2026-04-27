# S3 bucket for superbill PDF snapshots (Wave 42).
#
# HIPAA hardening — superbill PDFs were previously regenerated from live data
# on every download, meaning the same superbill_id produced different bytes
# on different days (charges shift, payments arrive, etc.). For accounting,
# audit, and patient legal records the bytes must be stable.
#
# This bucket holds the immutable PDF snapshot for each ehr_superbills row.
#
# HIPAA notes:
#   * KMS-encrypted at rest with the existing aws_kms_key.s3 (one-key-per-
#     domain pattern from kms.tf).
#   * Public access fully blocked (all four flags), non-TLS access denied
#     at the bucket policy.
#   * Versioning ENABLED — admin regenerate (?regenerate=true) overwrites the
#     same key; the previous version is preserved for tamper detection and
#     forensic audit.
#   * Lifecycle: STANDARD_IA at 90d, GLACIER at 365d, expiry at 2555d (7yr,
#     HIPAA retention floor). Noncurrent versions follow the same trajectory.
#   * Per-object SHA-256 is recomputed on every replay and compared to the
#     value persisted on ehr_superbills; mismatch fires the
#     billing.superbill.snapshot_integrity_failure audit event.
#   * Audit log entries on every lifecycle event (created, replayed,
#     regenerated, integrity_failure).

resource "aws_s3_bucket" "superbill_snapshots" {
  bucket        = "harbor-staging-superbills-${data.aws_caller_identity.current.account_id}"
  force_destroy = var.environment != "production"
  tags          = merge(local.common_tags, { Purpose = "superbill-snapshots" })
}

resource "aws_s3_bucket_public_access_block" "superbill_snapshots" {
  bucket                  = aws_s3_bucket.superbill_snapshots.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Versioning ENABLED — regenerate overwrites the same key, prior versions
# preserved for tamper detection / forensic audit.
resource "aws_s3_bucket_versioning" "superbill_snapshots" {
  bucket = aws_s3_bucket.superbill_snapshots.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "superbill_snapshots" {
  bucket = aws_s3_bucket.superbill_snapshots.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
    bucket_key_enabled = true
  }
}

# 7-year HIPAA retention floor. Hot for 90 days (active billing/audit window),
# warm IA for the next ~9 months, deep cold (Glacier) for the long tail.
resource "aws_s3_bucket_lifecycle_configuration" "superbill_snapshots" {
  bucket = aws_s3_bucket.superbill_snapshots.id

  rule {
    id     = "superbill-snapshots-7yr-retention"
    status = "Enabled"

    filter {}

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 365
      storage_class = "GLACIER"
    }

    expiration {
      days = 2555 # 7 years (HIPAA)
    }

    # Noncurrent versions (created when admins use ?regenerate=true) follow
    # the same trajectory so we don't leak stale PHI past 7yr.
    noncurrent_version_transition {
      noncurrent_days = 90
      storage_class   = "STANDARD_IA"
    }

    noncurrent_version_transition {
      noncurrent_days = 365
      storage_class   = "GLACIER"
    }

    noncurrent_version_expiration {
      noncurrent_days = 2555
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# Bucket policy: only the ECS task role may read/write. Deny everything else,
# including non-TLS access.
data "aws_iam_policy_document" "superbill_snapshots_bucket" {
  statement {
    sid    = "AllowEcsTaskRoleOnly"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:ListBucket",
      "s3:ListBucketVersions",
    ]
    resources = [
      aws_s3_bucket.superbill_snapshots.arn,
      "${aws_s3_bucket.superbill_snapshots.arn}/*",
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
      aws_s3_bucket.superbill_snapshots.arn,
      "${aws_s3_bucket.superbill_snapshots.arn}/*",
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

resource "aws_s3_bucket_policy" "superbill_snapshots" {
  bucket = aws_s3_bucket.superbill_snapshots.id
  policy = data.aws_iam_policy_document.superbill_snapshots_bucket.json
}

# Grant the ECS task role: PutObject / GetObject / GetObjectVersion /
# ListBucket on the superbill-snapshots bucket. Mirrors the
# task_insurance_cards inline-policy pattern from
# insurance-card-scans-bucket.tf so we don't multiply attachments to the
# task_s3 policy.
resource "aws_iam_role_policy" "task_superbill_snapshots" {
  name = "${local.name_prefix}-task-superbill-snapshots"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:GetObjectVersion",
        ]
        Resource = [
          "${aws_s3_bucket.superbill_snapshots.arn}/*",
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket",
          "s3:ListBucketVersions",
        ]
        Resource = [
          aws_s3_bucket.superbill_snapshots.arn,
        ]
      },
    ]
  })
}

output "superbill_snapshots_bucket" {
  value       = aws_s3_bucket.superbill_snapshots.bucket
  description = "S3 bucket holding immutable superbill PDF snapshots (KMS-encrypted, versioned, 7yr retention)."
}
