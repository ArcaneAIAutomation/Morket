# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY packages/backend/package.json packages/backend/package-lock.json ./
RUN npm ci

COPY packages/backend/tsconfig.json ./
COPY packages/backend/src/ ./src/
COPY packages/backend/migrations/ ./migrations/

RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production

RUN addgroup -g 1001 morket && adduser -u 1001 -G morket -s /bin/sh -D morket

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/migrations/ ./migrations/

RUN chown -R morket:morket /app

USER morket

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1

CMD ["node", "dist/index.js"]
