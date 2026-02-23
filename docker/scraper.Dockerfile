# Stage 1: Build dependencies
FROM python:3.11.7-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY packages/scraper/pyproject.toml ./
RUN pip install --no-cache-dir --prefix=/install .

# Stage 2: Production
FROM python:3.11.7-slim AS production

LABEL maintainer="morket-team"
LABEL version="1.0.0"
LABEL description="Morket scraping microservice with headless Chromium"

# Install Chromium dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxshmfence1 \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1001 morket && useradd -u 1001 -g morket -m -s /bin/bash morket

WORKDIR /app

COPY --from=builder /install /usr/local

COPY packages/scraper/src/ ./src/

# Install Playwright Chromium as morket user
RUN chown -R morket:morket /app
USER morket

RUN python -m playwright install chromium

ENV PLAYWRIGHT_BROWSERS_PATH=/home/morket/.cache/ms-playwright
ENV CHROMIUM_FLAGS="--no-sandbox --disable-dev-shm-usage --disable-gpu --disable-extensions --disable-background-networking"

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:8001/health || exit 1

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8001"]
