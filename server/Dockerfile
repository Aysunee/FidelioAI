# Pinned minor version to avoid silent Node upgrades across rebuilds.
# --env-file became stable in Node 20.12; 20.19 is a safe LTS floor.
FROM node:20.19-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Selective copy — only the files webhook.cjs actually needs at runtime.
# Explicitly excludes Hostinger MySQL legacy: index.cjs, db.cjs, schema.sql,
# signals_db.json (~330k lines), signals.json, users_db.json. These belong to
# the production MySQL backend and must not be shipped in the webhook image.
COPY server/webhook.cjs ./server/webhook.cjs
COPY server/migrations/ ./server/migrations/

USER node
EXPOSE 3001

# Container-level healthcheck. Uses Node's built-in http module so we don't
# need wget/curl in the image. Queries /health on the local bind address.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "--env-file=.env.webhook", "server/webhook.cjs"]
