# izLearn frontend image — builds the Vite app and serves it with nginx.
# Build context is the repo root (so the @izlearn/shared workspace is available).
FROM node:22-bookworm-slim AS build
ENV PUPPETEER_SKIP_DOWNLOAD=true
WORKDIR /app
COPY . .
RUN npm ci --legacy-peer-deps --workspace @izlearn/frontend --workspace @izlearn/shared --include-workspace-root=true
WORKDIR /app/frontend
RUN npm run build

FROM nginx:1.30-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
