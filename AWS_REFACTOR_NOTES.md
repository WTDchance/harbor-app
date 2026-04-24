# AWS Refactor Notes — `parallel/aws-v1`

This branch is the **parallel AWS-native** build of Harbor. It does **not** touch
the current production Railway/Supabase/Vapi stack. When (and only when) this
stack is validated end-to-end at `lab.harboroffice.ai`, we cut production over.

## Target architecture

| Concern       | Today (prod)                     | `parallel/aws-v1`                      |
| ------------- | -------------------------------- | -------------------------------------- |
| Hosting       | Railway                          | AWS ECS Fargate behind ALB             |
| DB            | Supabase Postgres                | AWS RDS Postgres 16                    |
| Auth          | Supabase auth (@supabase/ssr)    | AWS Cognito (aws-jwt-verify)           |
| LLM           | Anthropic API                    | AWS Bedrock (Haiku 4.5 + Sonnet 4.6)   |
| Email         | Resend                           | AWS SES                                |
| File storage  | Supabase storage                 | S3 (KMS-encrypted)                     |
| Voice         | Vapi + ElevenLabs + Twilio       | Retell + SignalWire (Vapi kept as fallback during validation) |
| Secrets       | Railway env vars                 | SSM Parameter Store (SecureString, KMS)|
| DNS           | Namecheap → Railway              | Route 53 → ALB                         |
| Observability | Vercel logs                      | CloudWatch + Container Insights        |
| Security      | —                                | GuardDuty, VPC Flow Logs, KMS everywhere|

## Directory layout

```
parallel-aws-v1/
├── .github/
│   └── workflows/
│       ├── aws-deploy.yml        # build → push → migrate → deploy → smoke
│       └── terraform-plan.yml    # PR-time plan + artifact upload
├── infra/
│   ├── terraform/                # full stack Terraform
│   │   ├── providers.tf
│   │   ├── variables.tf
│   │   ├── locals.tf
│   │   ├── kms.tf
│   │   ├── vpc.tf
│   │   ├── rds.tf
│   │   ├── ecr.tf
│   │   ├── ecs.tf
│   │   ├── alb.tf
│   │   ├── acm.tf
│   │   ├── route53.tf
│   │   ├── iam.tf
│   │   ├── cognito.tf
│   │   ├── ses.tf
│   │   ├── s3.tf
│   │   ├── guardduty.tf
│   │   ├── outputs.tf
│   │   ├── backend.hcl.example
│   │   └── terraform.tfvars.example
│   └── sql/
│       └── schema.sql            # idempotent Postgres DDL
├── .env.aws.example              # runtime env vars template
└── AWS_REFACTOR_NOTES.md         # this file
```

## Bootstrap (one-time, requires admin)

1. **Terraform state backing store** (create once, manually, since Terraform
   can't bootstrap its own backend):
   ```
   aws s3api create-bucket --bucket harbor-terraform-state-417242953135 \
     --region us-east-1
   aws s3api put-bucket-versioning --bucket harbor-terraform-state-417242953135 \
     --versioning-configuration Status=Enabled
   aws s3api put-bucket-encryption --bucket harbor-terraform-state-417242953135 \
     --server-side-encryption-configuration \
     '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
   aws dynamodb create-table --table-name harbor-terraform-lock \
     --attribute-definitions AttributeName=LockID,AttributeType=S \
     --key-schema AttributeName=LockID,KeyType=HASH \
     --billing-mode PAY_PER_REQUEST --region us-east-1
   ```

2. **IAM role for GitHub OIDC** (creates `harbor-github-deploy` and
   `harbor-github-plan` — do this before the CI workflows run):
   ```
   # See github-oidc-bootstrap.tf (TODO) or do it manually in IAM:
   #   - Trust: token.actions.githubusercontent.com
   #   - Subject: repo:WTDchance/harbor-ehr:ref:refs/heads/parallel/aws-v1
   #   - Attached policy: PowerUserAccess + iam:PassRole (scoped)
   ```

3. **IAM user `harbor-terraform`** (programmatic access) — used once locally to
   run the first `terraform apply`, after which CI takes over. CSV stored
   outside git.

## Running Terraform locally

```
cd infra/terraform
cp backend.hcl.example backend.hcl         # edit if needed
cp terraform.tfvars.example terraform.tfvars
terraform init -backend-config=backend.hcl
terraform plan
terraform apply
```

After apply, Terraform outputs include:
- `app_url` → https://lab.harboroffice.ai
- `rds_endpoint`
- `ecs_cluster_name`, `ecs_service_name`
- `ecr_app_repo_url`
- `cognito_user_pool_id`, `cognito_issuer`
- `s3_uploads_bucket`

## Applying the schema

Once RDS is up and the app subnets have access to it (easiest: run from ECS
exec, or via a small bastion / SSM port-forward):

```
psql -h $PGHOST -U $PGUSER -d harbor -f infra/sql/schema.sql
```

The file is idempotent — reruns are safe. The CI `migrate` job does this
automatically on every push.

## App refactor checklist (second coder)

The following source changes are required to make `harbor-app` work on this
stack. Do them on `parallel/aws-v1`, not on main.

- [ ] `lib/db.ts` — pg Pool, reads `PG*` env vars
- [ ] `lib/auth.ts` — Cognito JWT verification via `aws-jwt-verify`
- [ ] `lib/llm.ts` — Bedrock client (`@aws-sdk/client-bedrock-runtime`)
- [ ] `lib/email.ts` — SES client (`@aws-sdk/client-sesv2`)
- [ ] `lib/storage.ts` — S3 client (`@aws-sdk/client-s3`)
- [ ] Replace every `from '@supabase/ssr'` / `'@supabase/supabase-js'` import
- [ ] Replace every `supabaseAdmin.from('table')` with pg queries
- [ ] Dockerfile: multi-stage Node 20 → distroless, expose 3000, health at `/api/health`
- [ ] Health endpoint: `app/api/health/route.ts` returning 200 + db ping
- [ ] Commit format: `[AWS-REFACTOR] <scope>: <change>`

Self-verification before opening a PR:
```
git grep -l "@supabase" -- 'app/**' 'lib/**' | grep -v lib/supabase  # should be empty
git grep -l "@anthropic-ai/sdk"                                        # only lib/llm.ts
git grep -l "resend"                                                   # only lib/email.ts
```

## Validation ladder

Nothing goes to production until every step passes on `lab.harboroffice.ai`:

1. Terraform apply succeeds clean — all outputs populated.
2. Schema applies clean against empty RDS.
3. App task comes healthy; ALB target group shows 2/2 healthy.
4. Cognito sign-up → sign-in works end-to-end.
5. Health endpoint returns 200 for 5 minutes sustained.
6. Create a synthetic practice via API; provisioning flow completes without
   Vapi/Twilio side effects (use mock provider keys).
7. Bedrock Haiku + Sonnet both return 200 on test prompts.
8. SES sends to a seeded test inbox.
9. S3 upload round-trips.
10. GuardDuty shows no critical findings after 24h.

Only after 10/10 do we plan the production cutover.

## Known TODOs

- GitHub OIDC role Terraform module (currently manual).
- Bastion / SSM port-forward Terraform for DB admin access.
- CloudWatch alarms + SNS topic + PagerDuty wire-up.
- WAFv2 in front of ALB (before any PHI touches this stack).
- RDS read replica (production only).
- Secrets Manager rotation for RDS password (currently static in SSM).
- Voice provider adapter layer in app so Retell/Vapi are swappable per-practice.
