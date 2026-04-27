# Wave 38 TS2 — AWS Chime SDK Meetings for telehealth video.
#
# We use the meetings-only Chime SDK (chime:CreateMeeting / chime:CreateAttendee
# / chime:DeleteMeeting). HIPAA: covered by the existing AWS BAA; no PHI is
# embedded in the meeting metadata -- only the harbor appointment id maps a
# meeting to a patient, and that lookup happens server-side under our
# practice authn.

resource "aws_iam_role_policy" "task_chime" {
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "chime:CreateMeeting",
          "chime:CreateMeetingWithAttendees",
          "chime:GetMeeting",
          "chime:DeleteMeeting",
          "chime:CreateAttendee",
          "chime:GetAttendee",
          "chime:DeleteAttendee",
          "chime:ListAttendees",
        ]
        Resource = "*"
      },
    ]
  })
}

# ----------------------------------------------------------------------
# Wave 42 / T5 — Chime Media Pipelines for telehealth video recording.
#
# - chime:CreateMediaCapturePipeline / DeleteMediaCapturePipeline /
#   GetMediaCapturePipeline let our backend start/stop/inspect a
#   recording session bound to a meeting.
# - The pipeline writes artifacts to s3://harbor-staging-chime-recordings/
#   under a KMS key dedicated to the recording bucket.
# - 7-year HIPAA retention via a lifecycle rule.
#
# Recording is GATED at the API layer by an active
# consent_signatures row with kind='telehealth_recording'. Cloud
# infrastructure does not enforce consent — that's a software
# correctness property, not a Chime feature.

resource "aws_iam_role_policy" "task_chime_recording" {
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "chime:CreateMediaCapturePipeline",
          "chime:DeleteMediaCapturePipeline",
          "chime:GetMediaCapturePipeline",
          "chime:ListMediaCapturePipelines",
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:ListBucket",
        ]
        Resource = [
          aws_s3_bucket.chime_recordings.arn,
          "${aws_s3_bucket.chime_recordings.arn}/*",
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:GenerateDataKey",
        ]
        Resource = aws_kms_key.chime_recordings.arn
      },
    ]
  })
}

resource "aws_kms_key" "chime_recordings" {
  description              = "Encrypts Chime telehealth recording artifacts"
  enable_key_rotation      = true
  deletion_window_in_days  = 30
  tags                     = local.common_tags
}

resource "aws_kms_alias" "chime_recordings" {
  name          = "alias/${local.name_prefix}-chime-recordings"
  target_key_id = aws_kms_key.chime_recordings.key_id
}

resource "aws_s3_bucket" "chime_recordings" {
  bucket = "${local.name_prefix}-chime-recordings"
  tags   = local.common_tags
}

resource "aws_s3_bucket_server_side_encryption_configuration" "chime_recordings" {
  bucket = aws_s3_bucket.chime_recordings.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.chime_recordings.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "chime_recordings" {
  bucket                  = aws_s3_bucket.chime_recordings.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "chime_recordings" {
  bucket = aws_s3_bucket.chime_recordings.id
  versioning_configuration {
    status = "Enabled"
  }
}

# 7-year HIPAA retention. After that, expire current versions; previous
# versions purge after 90 days (covers accidental delete -> restore window).
resource "aws_s3_bucket_lifecycle_configuration" "chime_recordings" {
  bucket = aws_s3_bucket.chime_recordings.id

  rule {
    id     = "hipaa-7y-retention"
    status = "Enabled"
    expiration {
      days = 2555  # 7 years
    }
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# Bucket policy: only the ECS task role + Chime service principal can write.
resource "aws_s3_bucket_policy" "chime_recordings" {
  bucket = aws_s3_bucket.chime_recordings.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowChimeServicePut"
        Effect    = "Allow"
        Principal = { Service = "mediapipelines.chime.amazonaws.com" }
        Action    = ["s3:PutObject"]
        Resource  = "${aws_s3_bucket.chime_recordings.arn}/*"
        Condition = {
          StringEquals = {
            "s3:x-amz-server-side-encryption" = "aws:kms"
          }
        }
      },
      {
        Sid       = "DenyUnencryptedPut"
        Effect    = "Deny"
        Principal = "*"
        Action    = ["s3:PutObject"]
        Resource  = "${aws_s3_bucket.chime_recordings.arn}/*"
        Condition = {
          StringNotEquals = {
            "s3:x-amz-server-side-encryption" = "aws:kms"
          }
        }
      },
    ]
  })
}

output "chime_recordings_bucket" {
  value = aws_s3_bucket.chime_recordings.bucket
}

