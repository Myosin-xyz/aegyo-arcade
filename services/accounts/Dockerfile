# syntax=docker/dockerfile:1

# Node 24.21.0 official multi-platform image index, observed 2026-09-11.
ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM ${NODE_IMAGE} AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node ui ./ui
USER node
CMD ["npm", "start"]

# Local/CI-only target for the isolated Linux proof. PostgreSQL never ships in
# the production target and the proof itself disables TCP and ignores DATABASE_URL.
FROM ${NODE_IMAGE} AS proof
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql \
    && ln -s /usr/lib/postgresql/*/bin/initdb /usr/local/bin/initdb \
    && ln -s /usr/lib/postgresql/*/bin/pg_ctl /usr/local/bin/pg_ctl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force
COPY --chown=node:node . .
RUN mkdir -p /app/.proof && chown node:node /app/.proof
USER node
CMD ["sh", "-c", "npm test && npm run proof"]

# Keep the deployable application as the default/final target. Railway's
# automatic Dockerfile build must never select the PostgreSQL-equipped proof.
FROM production AS runtime
