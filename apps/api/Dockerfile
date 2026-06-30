# Build context must be the repo root (npm workspaces: api depends on @evenup/shared)
FROM node:22-alpine AS build
WORKDIR /app

# Manifests first for better layer caching
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm ci --ignore-scripts

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN npm run build --workspace=packages/shared

WORKDIR /app/apps/api
RUN npx prisma generate
RUN npx tsc

FROM node:22-alpine
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api ./apps/api

WORKDIR /app/apps/api
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node dist/server.js"]
