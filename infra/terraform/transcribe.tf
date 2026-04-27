# Wave 38 M2 — AWS Transcribe pipeline for therapist voice notes.
#
# Therapist taps Mic in NoteEditor, records audio (MediaRecorder), POSTs the
# blob to /api/transcribe. The route streams the file to this S3 bucket,
# kicks off Amazon Transcribe (HIPAA-eligible under the existing AWS BAA),
# and polls/returns the transcript. Sonnet then cleans the transcript into
# the patient's preferred note format (SOAP/DAP/BIRP/GIRP/Narrative).
#
# Lifecycle: raw audio is deleted from S3 after 24 hours. Transcript text
# lives only in the note record (PHI in RDS, encrypted at rest).

resource "aws_s3_bucket" "transcribe_uploads" {
  # Wave 38 spec pinned this bucket name exactly:
  #   harbor-staging-transcribe-uploads-417242953135
  # so callers can reference it without an extra terraform output lookup.
  bucket        = "${local.name_prefix}-transcribe-uploads-${data.aws_caller_identity.current.account_id}"
  force_destroy = var.environment != "production"
  tags          = merge(local.common_tags, { Purpose = "transcribe-uploads" })
}

resource "aws_s3_bucket_public_access_block" "transcribe_uploads" {
  bucket                  = aws_s3_bucket.transcribe_uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "transcribe_uploads" {
  bucket = aws_s3_bucket.transcribe_uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
    bucket_key_enabled = true
  }
}

# 24h object expiration — raw audio never lives longer than a day.
resource "aws_s3_bucket_lifecycle_configuration" "transcribe_uploads" {
  bucket = aws_s3_bucket.transcribe_uploads.id

  rule {
    id     = "expire-raw-audio"
    status = "Enabled"

    expiration {
      days = 1
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# Block all unencrypted requests as a belt-and-braces measure.
resource "aws_s3_bucket_policy" "transcribe_uploads" {
  bucket = aws_s3_bucket.transcribe_uploads.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyUnEncryptedTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.transcribe_uploads.arn,
          "${aws_s3_bucket.transcribe_uploads.arn}/*",
        ]
        Condition = {
          Bool = { "aws:SecureTransport" = "false" }
        }
      },
    ]
  })
}

# Grant the ECS task role: Put/Get/Delete on this bucket + StartTranscriptionJob
# / GetTranscriptionJob on the Transcribe service.
resource "aws_iam_role_policy" "task_transcribe" {
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
          aws_s3_bucket.transcribe_uploads.arn,
          "${aws_s3_bucket.transcribe_uploads.arn}/*",
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "transcribe:StartTranscriptionJob",
          "transcribe:StartStreamTranscription",
          "transcribe:GetTranscriptionJob",
          "transcribe:ListTranscriptionJobs",
          "transcribe:DeleteTranscriptionJob",
        ]
        # Transcribe job ARNs aren't predictable by name (they include the
        # job name caller picks); scope is the service itself which is
        # standard for Transcribe.
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey",
        ]
        Resource = aws_kms_key.s3.arn
      },
    ]
  })
}

output "transcribe_uploads_bucket" {
  value       = aws_s3_bucket.transcribe_uploads.bucket
  description = "S3 bucket holding raw audio for AWS Transcribe (24h lifecycle)."
}
