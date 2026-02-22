# Stage 1: Install dependencies and Playwright/Chromium
FROM python:3.11-slim AS builder

WORKDIR /app

# Install system deps for Playwright
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy project config and install Python deps
COPY pyproject.toml ./
RUN pip install --no-cache-dir . \
    && playwright install --with-deps chromium

# Stage 2: Application
FROM python:3.11-slim

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy Playwright browsers from builder
COPY --from=builder /root/.cache/ms-playwright /root/.cache/ms-playwright

# Install Chromium runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libwayland-client0 \
    && rm -rf /var/lib/apt/lists/*

# Copy application code
COPY src/ ./src/
COPY tests/ ./tests/

# Chromium flags for containerized operation
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright
ENV SCRAPER_LOG_LEVEL=INFO

# Expose service port
EXPOSE 8001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8001/health || exit 1

# Graceful shutdown: SIGTERM with 30s grace
STOPSIGNAL SIGTERM

# Run the application
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8001"]
