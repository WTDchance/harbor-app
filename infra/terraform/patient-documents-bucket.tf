# S3 bucket for patient-uploaded documents (consent forms scanned by patient,
# prior treatment records they want to share, ID/insurance docs they want
# to attach to their chart, etc.).
#
# HIPAA notes:
#   * KMS-encrypted with the existing aws_kms_key.s3 (one-key-per-domain).
#   * Public access fully blocked, non-TLS access denied at the bucket policy.
#   * Versioning ON — patient documents are part of the medical record;
#     accidental overwrite or delete should be recoverable.
#   * Lifecycle: 30 days hot → Standard-IA → Glacier at 365 days, then
#     hold for 7 years (state retention statutes for medical records range
#     from 5–10 years; 7 covers the OCR HIPAA documentation rule). Originals
#     are not deleted by lifecycle; soft-delete is via the API DELETE which
#     creates a delete marker (versioning preserves the bytes).
#   * Server-side max upload is enforced by the API (10 MB) plus the
#     standard CORS / presigned URL constraints.

resource "aws_s3_bucket" "patient_documents" {
  bucket        = "harbor-staging-patient-documents-${data.aws_caller_identity.current.account_id}"
  force_destroy = var.environment != "production"
  tags          = merge(local.common_tags, { Purpose = "patient-documents" })
}

resource "aws_s3_bucket_public_access_block" "patient_documents" {
  bucket                  = aws_s3_bucket.patient_documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "patient_documents" {
  bucket = aws_s3_bucket.patient_documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "patient_documents" {
  bucket = aws_s3_bucket.patient_documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "patient_documents" {
  bucket = aws_s3_bucket.patient_documents.id

  rule {
    id     = "transition-patient-documents"
    status = "Enabled"

    filter {}

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }
    transition {
      days          = 365
      storage_class = "GLACIER"
    }

    # Noncurrent (delete-marker'd) versions still retain for the 7y window
    # before being expired, matching the live-version retention story.
    noncurrent_version_transition {
      noncurrent_days = 30
      storage_class   = "STANDARD_IA"
    }
    noncurrent_version_transition {
      noncurrent_days = 365
      storage_class   = "GLACIER"
    }
    noncurrent_version_expiration {
      noncurrent_days = 2555 # ~7 years
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

data "aws_iam_policy_document" "patient_documents_bucket" {
  statement {
    sid    = "AllowEcsTaskRoleOnly"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:DeleteObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.patient_documents.arn,
      "${aws_s3_bucket.patient_documents.arn}/*",
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
      aws_s3_bucket.patient_documents.arn,
      "${aws_s3_bucket.patient_documents.arn}/*",
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

resource "aws_s3_bucket_policy" "patient_documents" {
  bucket = aws_s3_bucket.patient_documents.id
  policy = data.aws_iam_policy_document.patient_documents_bucket.json
}

resource "aws_iam_role_policy" "task_patient_documents" {
  name = "${local.name_prefix}-task-patient-documents"
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
          "s3:DeleteObject",
          "s3:ListBucket",
        ]
        Resource = [
          aws_s3_bucket.patient_documents.arn,
          "${aws_s3_bucket.patient_documents.arn}/*",
        ]
      },
    ]
  })
}

output "patient_documents_bucket" {
  value       = aws_s3_bucket.patient_documents.bucket
  description = "S3 bucket holding patient-uploaded documents (KMS-encrypted, 7y retention)."
}
