# ADR 001: SPA Mode for React Router

## Status

Accepted

## Context

React Router v8 offers two deployment modes:

1. **SPA mode** — client-side only. File-based routing with Loaders and Actions run entirely in the browser. The API remains a separate Fastify server.
2. **SSR / Framework mode** — server-side rendering with React Router as the full-stack framework. Would replace or wrap the existing Fastify API.

We need to choose a mode for the planned migration from React Router v7 (manual routes) to v8 (file-based routing). This ADR was originally written for the v6→v7 migration and updated to reflect the subsequent v7→v8 upgrade — the decision and rationale are unchanged.

## Decision

Use **SPA mode**.

## Rationale

- **Every view is authenticated.** Even-Up requires login before any meaningful content is shown. There is no public-facing content that benefits from server-side rendering or SEO indexing.
- **Fastify API is already built and tested.** 26 integration and unit tests cover auth, expenses, settlements, balances, debt simplification, and group join requests. SSR mode would require either replacing Fastify with React Router's server or proxying between them — added complexity for no user-facing benefit.
- **Simpler deployment.** SPA mode produces a static build (`build/client/`) served by nginx or any CDN. The API deploys independently. No Node.js server needed for the frontend in production.
- **Shared Zod schemas work the same way.** Client-side Loaders and Actions can import from `@evenup/shared` and validate forms before sending requests to the API. No server-side rendering needed for this.

## Consequences

- Loaders fetch data via HTTP to the Fastify API (not direct DB access).
- Actions submit forms via HTTP to the Fastify API.
- Initial page load shows a loading state while the SPA boots and fetches data.
- If SSR becomes desirable later (e.g., public group summary pages), this decision can be revisited without affecting the API layer.
