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
