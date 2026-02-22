# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY packages/frontend/package.json packages/frontend/package-lock.json ./
RUN npm ci

COPY packages/frontend/tsconfig.json packages/frontend/vite.config.ts ./
COPY packages/frontend/tailwind.config.js packages/frontend/postcss.config.js ./
COPY packages/frontend/index.html ./
COPY packages/frontend/src/ ./src/

RUN npm run build

# Stage 2: Production (Nginx)
FROM nginx:alpine AS production

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# SPA routing config
COPY docker/nginx.conf /etc/nginx/conf.d/morket.conf

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Nginx runs as non-root via nginx user (built-in)
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && chown nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
