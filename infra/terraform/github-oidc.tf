# GitHub Actions OIDC trust + roles.
# Lets workflows in WTDchance/harbor-app assume IAM roles via short-lived
# OIDC tokens — no static AWS keys in repo secrets.
#
# Two roles:
#   harbor-github-plan   — read-only, used by PR plan workflow
#   harbor-github-deploy — push images, register task defs, update services
#
# Trust is scoped by repo and branch/tag. Adjust `allowed_refs` if you ever
# deploy from a different branch (e.g. main once we cut over).

locals {
  github_repo = "WTDchance/harbor-app"
  # Allow plan + deploy from these refs. Add "refs/heads/main" once main is the
  # deploy branch.
  allowed_refs = [
    "repo:${local.github_repo}:ref:refs/heads/parallel/aws-v1",
    "repo:${local.github_repo}:ref:refs/heads/main",
    "repo:${local.github_repo}:pull_request",
  ]
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # GitHub's OIDC root CA thumbprints (kept for legacy compat; AWS now
  # validates against its own trust store regardless).
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]

  tags = {
    Name        = "github-actions-oidc"
    Project     = "harbor"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# --- Trust policy shared by both roles ---------------------------------------
data "aws_iam_policy_document" "github_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.allowed_refs
    }
  }
}

# --- harbor-github-plan: read-only -------------------------------------------
resource "aws_iam_role" "github_plan" {
  name               = "harbor-github-plan"
  assume_role_policy = data.aws_iam_policy_document.github_assume.json

  tags = {
    Name        = "harbor-github-plan"
    Project     = "harbor"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_iam_role_policy_attachment" "github_plan_readonly" {
  role       = aws_iam_role.github_plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# Plan also needs to read terraform state in S3 + lock in DynamoDB
data "aws_iam_policy_document" "github_plan_state" {
  statement {
    effect  = "Allow"
    actions = ["s3:ListBucket", "s3:GetObject"]
    resources = [
      "arn:aws:s3:::harbor-terraform-state-${data.aws_caller_identity.current.account_id}",
      "arn:aws:s3:::harbor-terraform-state-${data.aws_caller_identity.current.account_id}/*",
    ]
  }
  statement {
    effect    = "Allow"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
    resources = ["arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/harbor-terraform-lock"]
  }
}

resource "aws_iam_role_policy" "github_plan_state" {
  name   = "tf-state-access"
  role   = aws_iam_role.github_plan.id
  policy = data.aws_iam_policy_document.github_plan_state.json
}

# --- harbor-github-deploy: push to ECR, update ECS ---------------------------
resource "aws_iam_role" "github_deploy" {
  name               = "harbor-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_assume.json

  tags = {
    Name        = "harbor-github-deploy"
    Project     = "harbor"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

data "aws_iam_policy_document" "github_deploy" {
  # ECR auth (account-wide; required for docker login)
  statement {
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # ECR push to our app repos only
  statement {
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:DescribeImages",
      "ecr:DescribeRepositories",
    ]
    resources = [
      aws_ecr_repository.app.arn,
    ]
  }

  # ECS deploy: register new task definitions + update services
  statement {
    effect = "Allow"
    actions = [
      "ecs:DescribeServices",
      "ecs:DescribeTaskDefinition",
      "ecs:DescribeTasks",
      "ecs:ListTasks",
      "ecs:RegisterTaskDefinition",
      "ecs:UpdateService",
      "ecs:RunTask",
    ]
    resources = ["*"]
  }

  # Pass the task + execution roles into new task definitions
  statement {
    effect  = "Allow"
    actions = ["iam:PassRole"]
    resources = [
      aws_iam_role.task.arn,
      aws_iam_role.task_execution.arn,
    ]
  }

  # Read SSM parameters (so a one-off migration task can pull DB creds)
  statement {
    effect    = "Allow"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/harbor-staging/*"]
  }

  # Decrypt SSM SecureStrings (KMS default key for SSM)
  statement {
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.aws_region}.amazonaws.com"]
    }
  }

  # Logs (for tailing migration task output)
  statement {
    effect = "Allow"
    actions = [
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
      "logs:GetLogEvents",
      "logs:FilterLogEvents",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "deploy-permissions"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}

# --- Outputs -----------------------------------------------------------------
output "github_actions_role_plan" {
  description = "Role ARN for terraform-plan workflow"
  value       = aws_iam_role.github_plan.arn
}

output "github_actions_role_deploy" {
  description = "Role ARN for aws-deploy workflow"
  value       = aws_iam_role.github_deploy.arn
}
