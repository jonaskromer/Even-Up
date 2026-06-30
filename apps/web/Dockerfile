# Build context must be the repo root (npm workspaces: web depends on @evenup/shared)
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --ignore-scripts

COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN npm run build --workspace=packages/shared

# Empty string => same-origin requests, proxied by nginx to the api container (see nginx.conf)
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}

# Vite inlines these at build time, so they must be passed as build args, not just
# runtime env — see docker-compose.prod.yml's web.build.args.
ARG VITE_SUPABASE_URL=""
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ARG VITE_SUPABASE_PUBLISHABLE_KEY=""
ENV VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY}

WORKDIR /app/apps/web
RUN npm run build
# Compute SHA-256 hashes of inline scripts and write nginx.conf with them
# substituted for the CSP_SCRIPT_HASHES placeholder — no 'unsafe-inline' needed.
RUN node scripts/inject-csp-hashes.mjs

FROM nginx:alpine
COPY --from=build /app/apps/web/build/client /usr/share/nginx/html
COPY --from=build /tmp/nginx_final.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
