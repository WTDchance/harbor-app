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
