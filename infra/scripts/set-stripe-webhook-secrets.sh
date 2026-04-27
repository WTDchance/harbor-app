#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Codify the Stripe webhook signing secrets into staging SSM and roll ECS.
#
# Background
#   Wave 25 added two SSM parameters (subscriptions + EHR billing) and wired
#   them into the ECS task as STRIPE_WEBHOOK_SECRET / STRIPE_EHR_WEBHOOK_SECRET.
#   The Terraform resources are placeholders with lifecycle ignore_changes,
#   so the actual whsec_ values must be set out-of-band via this runbook.
#
# Stripe sandbox endpoints  -> staging SSM names
#   subscription endpoint   -> /harbor-staging/api-keys/stripe-webhook-subscriptions
#   EHR billing endpoint    -> /harbor-staging/api-keys/stripe-webhook-billing
#
# DO NOT touch the production Stripe Live mode webhook from this script.
# Production lives under a separate name_prefix at harborreceptionist.com and
# its whsec_ rotation is a manual change-control event, not a runbook step.
#
# Usage
#   export STRIPE_WHSEC_SUBSCRIPTIONS=whsec_xxxxxxxxxxxxxxxxxx
#   export STRIPE_WHSEC_BILLING=whsec_xxxxxxxxxxxxxxxxxx
#   bash infra/scripts/set-stripe-webhook-secrets.sh
#
# Requires: AWS CLI v2, credentials with ssm:PutParameter + ecs:UpdateService
# in the staging account/region.
# -----------------------------------------------------------------------------

set -euo pipefail

: "${AWS_REGION:=us-east-1}"
: "${NAME_PREFIX:=harbor-staging}"
: "${ECS_CLUSTER:=${NAME_PREFIX}}"
: "${ECS_SERVICE:=${NAME_PREFIX}-app}"

if [[ -z "${STRIPE_WHSEC_SUBSCRIPTIONS:-}" || -z "${STRIPE_WHSEC_BILLING:-}" ]]; then
  echo "error: set STRIPE_WHSEC_SUBSCRIPTIONS and STRIPE_WHSEC_BILLING in env first" >&2
  echo "       (these are the whsec_ values from the Stripe Dashboard webhooks page)" >&2
  exit 1
fi

# Sanity-check that the values look like Stripe webhook secrets.
for var in STRIPE_WHSEC_SUBSCRIPTIONS STRIPE_WHSEC_BILLING; do
  val="${!var}"
  if [[ "${val}" != whsec_* ]]; then
    echo "error: ${var} does not start with whsec_ -- refusing to put a non-secret into SSM" >&2
    exit 1
  fi
done

ssm_kms_key_id="$(aws --region "${AWS_REGION}" kms describe-key \
  --key-id "alias/${NAME_PREFIX}-ssm" \
  --query 'KeyMetadata.Arn' --output text)"

put_secret() {
  local name="$1"
  local value="$2"
  echo "-> ssm put-parameter ${name}"
  aws --region "${AWS_REGION}" ssm put-parameter \
    --name "${name}" \
    --type SecureString \
    --key-id "${ssm_kms_key_id}" \
    --overwrite \
    --value "${value}" \
    >/dev/null
}

put_secret "/${NAME_PREFIX}/api-keys/stripe-webhook-subscriptions" "${STRIPE_WHSEC_SUBSCRIPTIONS}"
put_secret "/${NAME_PREFIX}/api-keys/stripe-webhook-billing"       "${STRIPE_WHSEC_BILLING}"

echo "-> ecs update-service --force-new-deployment"
aws --region "${AWS_REGION}" ecs update-service \
  --cluster "${ECS_CLUSTER}" \
  --service "${ECS_SERVICE}" \
  --force-new-deployment \
  --query 'service.deployments[0].{id:id,status:status,desired:desiredCount}' \
  --output table

echo
echo "Done. To verify, after the new task is steady, send a Stripe test event:"
echo "  - Dashboard -> Developers -> Webhooks -> pick the staging endpoint -> Send test webhook"
echo "  - Tail CloudWatch:  /ecs/${NAME_PREFIX}/app  (filter: stripe webhook)"
echo "  - Expect 200 + 'event verified' (or equivalent) log line."
