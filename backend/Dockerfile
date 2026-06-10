# izLearn backend image. Includes Chromium for Puppeteer (PDF generation) and
# the postgres client for pg_dump backups. Build context is the repo root.
FROM node:20-bookworm-slim

# Set Puppeteer config before apt so Chromium isn't re-downloaded by npm install
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ca-certificates fonts-liberation postgresql-client \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
      libcairo2 libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
# Install all deps (including devDependencies) so tsx is available at runtime
RUN npm install

# Set NODE_ENV after install so devDependencies are not skipped
ENV NODE_ENV=production

WORKDIR /app/backend
RUN npx prisma generate

EXPOSE 4000
# Apply migrations, seed (idempotent), then start.
CMD ["sh", "-c", "npx prisma migrate deploy && (npm run seed || true) && npm run start"]
