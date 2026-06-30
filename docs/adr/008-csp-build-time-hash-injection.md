# ADR 008: Build-time CSP Script Hash Injection

## Status

Accepted

## Context

Vite's SPA entry point (`index.html`) contains one or more inline `<script>` blocks at build time (the module preload bootstrap). A strict Content Security Policy that omits `'unsafe-inline'` from `script-src` blocks these scripts from executing, breaking the app entirely.

Two common approaches exist:

1. **`'unsafe-inline'` in `script-src`** — simple but defeats the main purpose of CSP for scripts; allows any injected inline script (XSS payloads) to execute.
2. **`'unsafe-hashes'` or per-script SHA-256 hashes** — the browser only allows scripts whose content exactly matches a whitelisted hash; injected scripts have different content and are blocked.

## Decision

Compute SHA-256 hashes of every inline `<script>` block in the Vite build output **at build time**, and inject them into `nginx.conf` before the image is finalised. The resulting `script-src` contains only `'self'` plus the exact hash(es) — no `'unsafe-inline'`.

## Implementation

`apps/web/scripts/inject-csp-hashes.mjs` runs as the last step of the web Docker build (`package.json` `build` script via the Dockerfile):

1. Reads `build/client/index.html` produced by `vite build`.
2. Matches every inline `<script>` without a `src` attribute using a regex.
3. Computes `sha256(content)` → base64 for each, formatted as `'sha256-<base64>'`.
4. Replaces the `CSP_SCRIPT_HASHES` placeholder in `nginx.conf` with the space-separated hash list.
5. Writes the final nginx config to `/tmp/nginx_final.conf`, which the multi-stage Dockerfile `COPY`s into the nginx image.

The placeholder approach keeps the `nginx.conf` in source control readable (no raw base64 noise). Hashes are regenerated on every production build, so they stay correct even if Vite's bootstrap script changes between versions.

`style-src` deliberately retains `'unsafe-inline'` — Tailwind CSS emits inline `style` attributes via its `@apply` mechanism, and there is no practical way to hash dynamically generated attribute values.

## Rationale

- Inline-script hashes eliminate the most impactful `'unsafe-inline'` in `script-src` with minimal complexity: a 30-line Node script run once at build time.
- The solution is self-contained in the Docker build pipeline; no runtime server-side nonce generation or additional middleware is required.
- Hashes break if the Vite output changes (which is intentional — if the script changes, the old hash no longer applies, and the build step regenerates the correct one automatically).

## Consequences

- The `nginx.conf` shipped in the Git repository contains the literal string `CSP_SCRIPT_HASHES` and is not a valid nginx config on its own. The final config lives in `/tmp/nginx_final.conf` and is never committed. This is intentional.
- Local development (`npm run dev`) is not affected — the CSP header is only present in the nginx-served production build.
- If `inject-csp-hashes.mjs` finds no inline scripts (e.g., a future Vite version externalises the bootstrap), it emits a warning but still produces a valid nginx config (the placeholder is replaced with an empty string, leaving `script-src 'self'`).
