FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server/ ./server/
USER node
EXPOSE 3001
CMD ["node", "--env-file=.env.webhook", "server/webhook.cjs"]
