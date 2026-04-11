# Pinned minor version to avoid silent Node upgrades across rebuilds.
# --env-file became stable in Node 20.12; 20.19 is a safe LTS floor.
FROM node:20.19-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server/ ./server/
USER node
EXPOSE 3001

# Container-level healthcheck. Uses Node's built-in http module so we don't
# need wget/curl in the image. Queries /health on the local bind address.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "--env-file=.env.webhook", "server/webhook.cjs"]
