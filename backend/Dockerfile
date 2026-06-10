# izLearn backend image. Includes Chromium for Puppeteer (PDF generation) and
# the MongoDB Database Tools (mongodump/mongorestore) for backups. Build context
# is the repo root.
FROM node:20-bookworm-slim

# Set Puppeteer config before apt so Chromium isn't re-downloaded by npm install
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ca-certificates fonts-liberation gnupg curl \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
      libcairo2 libasound2 \
    && rm -rf /var/lib/apt/lists/*

# MongoDB Database Tools (mongodump / mongorestore) for the Backup module.
# Installed from MongoDB's official apt repo (serves amd64 + arm64).
RUN curl -fsSL https://pgp.mongodb.com/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/mongodb.gpg] https://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" \
         > /etc/apt/sources.list.d/mongodb-org-7.0.list \
    && apt-get update && apt-get install -y --no-install-recommends mongodb-database-tools \
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
# Sync the schema to MongoDB (db push — Mongo has no SQL migrations), seed
# (idempotent), then start.
CMD ["sh", "-c", "npx prisma db push --skip-generate && (npm run seed || true) && npm run start"]
