# Multi-stage build for Next.js 14.
# Optimized for ECS Fargate: small final image, no dev deps, non-root user.
#
# Build context: repo root (so this picks up app/, lib/, components/, etc.)

# --- deps: install all node_modules including dev deps so we can build ---
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# Install python + build tooling for any native modules (bcrypt, sharp, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# --- build: compile Next.js ---
FROM node:20-bookworm-slim AS builder
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* are inlined at build time. They MUST be present here or
# middleware/edge code that references them will throw at runtime regardless
# of what ECS injects later.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_GTM_ID
ARG NEXT_PUBLIC_CLARITY_ID
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_ADMIN_EMAIL
ARG NEXT_PUBLIC_VAPI_ASSISTANT_ID
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_GTM_ID=$NEXT_PUBLIC_GTM_ID \
    NEXT_PUBLIC_CLARITY_ID=$NEXT_PUBLIC_CLARITY_ID \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_ADMIN_EMAIL=$NEXT_PUBLIC_ADMIN_EMAIL \
    NEXT_PUBLIC_VAPI_ASSISTANT_ID=$NEXT_PUBLIC_VAPI_ASSISTANT_ID

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# Prune devDependencies for the runtime image
RUN npm prune --omit=dev

# --- runner: minimal runtime ---
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# non-root user
RUN groupadd -r app && useradd -r -g app -u 1001 app

# Bring in the built app + production node_modules
COPY --from=builder --chown=app:app /app/.next ./.next
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/package.json ./package.json
COPY --from=builder --chown=app:app /app/next.config.js ./next.config.js

USER app
EXPOSE 3000

# next start respects PORT/HOSTNAME env
CMD ["npx", "next", "start"]
