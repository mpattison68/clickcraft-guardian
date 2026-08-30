# ---------- Stage 1: build the frontend SPA ----------
FROM node:22-alpine AS frontend
WORKDIR /build
COPY package.json bun.lock* package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build:spa

# ---------- Stage 2: build the backend ----------
FROM node:22-alpine AS backend
WORKDIR /build
COPY server/package.json ./
RUN npm install --no-audit --no-fund
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

# ---------- Stage 3: runtime ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache tini curl && addgroup -S app && adduser -S app -G app

COPY server/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=backend /build/dist ./dist
# SQL migrations are not compiled by tsc — copy them explicitly.
COPY server/src/db/migrations ./dist/db/migrations
COPY --from=frontend /build/dist/spa ./public

USER app
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${APP_PORT:-4000}/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/api.js"]
