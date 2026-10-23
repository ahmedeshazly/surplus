# Owner: R1. Local one-command boot: docker compose up
FROM node:20-bookworm-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
EXPOSE 3000 4000
CMD ["sh", "-c", "pnpm seed && (pnpm --filter @surplus/api dev & pnpm --filter @surplus/web exec next dev -H 0.0.0.0 -p 3000 & wait)"]
