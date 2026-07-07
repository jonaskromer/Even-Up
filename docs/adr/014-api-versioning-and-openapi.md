# ADR 014: URL-Path API Versioning + Static OpenAPI/Swagger Documentation

## Status

Accepted

## Context

Two gaps were flagged during a lecture-vs-implementation audit (see
`.ai/lecture-coverage.md`, VL06 — REST & APIs):

1. **No API versioning scheme.** Every endpoint lived directly under `/api/*` with
   no way to introduce a breaking change without either breaking every existing
   client in place or inventing an ad hoc migration path later.
2. **No OpenAPI/Swagger spec.** `docs/api-reference.md` is a comprehensive,
   hand-written Markdown reference, but it's not machine-readable, can't be
   imported into Postman/Insomnia as a collection, and isn't browsable as an
   interactive UI the way the lecture's "API-first design" material describes.

## Decision

### Versioning: URL path prefix, `/api/v1`

The lecture presents two options — a URL path prefix (`/v1/...`) or an `Accept`
header (`Accept: application/vnd.api+json;version=1`). URL-path versioning was
chosen:

- It's visible and testable with zero extra tooling (`curl`, browser devtools,
  Playwright route interception all just see it as part of the URL).
- It's what virtually every OpenAPI/Swagger toolchain assumes by default —
  header-based versioning would have made the new spec (below) significantly
  more awkward to model.
- `/api/health` is deliberately **excluded** from versioning. It's an
  infrastructure-facing liveness probe (Docker healthcheck, uptime monitoring),
  not part of the client-facing API contract that would ever need a `v2` — giving
  it a version number would be versioning something that, by design, must never
  change shape.

### Implementation: one prefix constant on the backend, one path transform on the frontend

`apps/api/src/app.ts` registers every route module with a single `API_PREFIX =
'/api/v1'` constant — bumping the version later is a one-line change, not a
per-route edit.

The frontend does **not** hardcode `/api/v1/...` at every call site. Every request
already funnels through three functions in `apps/web/app/lib/apiClient.ts`
(`request`, `postFileStream`, `downloadFile`); a `versionPath()` helper rewrites
`/api/...` → `/api/v1/...` (except `/api/health`) inside those three functions
only. The ~25 components and routes that call `api.get('/api/groups/...')` etc.
keep writing the same unversioned-looking paths they always did — moving to `v2`
later means changing one constant in one file, not touching every call site.
This was verified directly: after implementing the change, zero frontend
component files needed edits, and all existing component/route tests (which mock
`api`/`downloadFile`/`postFileStream` themselves and assert on the *unversioned*
argument the component passed in) kept passing unmodified.

The one exception is `OAuthButtons.tsx`, which navigates via
`window.location.href` (a real page navigation to start the OAuth redirect,
not a `fetch()` call) — it doesn't go through `apiClient.ts` and was updated by
hand, along with the backend's own self-referencing OAuth callback URL and PKCE
cookie `path` in `apps/api/src/routes/auth.ts` (both must exactly match the
route's real, versioned path).

### Documentation: a static, hand-authored OpenAPI 3.0 document, not schema-driven auto-generation

`@fastify/swagger` supports two integration styles: (a) dynamic generation from
each route's own `schema: {...}` option, or (b) serving a fully static document
supplied up front. This project uses (b), for one deliberate reason: every route
already validates its input manually via `.parse()` against a Zod schema inside
the handler body, not via Fastify's own `schema.body` (which would trigger
Fastify's built-in ajv-based validation, running *before* the handler, with a
different error shape than the app's own `ZodError → 400 "Ungültige Eingabe"`
convention). Switching every route to schema-driven validation just to get
automatic OpenAPI generation would have meant re-validating ~15 route files
against 104 already-passing tests for a documentation-only feature — not a
reasonable trade.

Instead, `apps/api/src/openapi.ts` exports a static `OpenAPIV3.Document`,
registered via `{ mode: 'static', specification: { document: openApiDocument } }`,
served interactively at `/api/docs` (Swagger UI) and as raw JSON at
`/api/docs/json` — both deliberately unversioned, for the same reason
`/api/health` is: they describe the API rather than being part of its versioned
contract.

**Request-body schemas are not hand-duplicated where a shared Zod schema already
exists.** Zod v4 ships a native `z.toJSONSchema()` converter; `openapi.ts` imports
the real, already-enforced schemas from `@evenup/shared`
(`createExpenseSchema`, `createGroupSchema`, `addMemberSchema`,
`createSettlementSchema`, `createReceiptExpenseSchema`,
`updateReceiptExpenseSchema`) and converts them directly into
`components.schemas` entries referenced via `$ref`. The documented request shape
for e.g. `POST /groups/{groupId}/expenses` can never silently drift from what the
API actually accepts, because it's generated from the identical schema object at
build time — there's only one definition, not two to keep in sync. Auth
endpoints (login/register/etc.) use schemas defined locally inside
`apps/api/src/routes/auth.ts` that aren't exported for reuse; those are
hand-described in `openapi.ts` to match `docs/api-reference.md`'s existing
examples instead.

## Rationale

- URL-path versioning plus a single centralized rewrite point gives the benefit
  of "versioned API" (a clear point to introduce breaking changes later) without
  the cost of touching ~25 call sites now or paying that cost again on the next
  version bump.
- A static OpenAPI document avoids retrofitting Fastify's schema-driven
  validation onto a codebase that intentionally validates via Zod in the handler
  body — the safer, lower-risk path to "there is a real spec" without risking the
  104 tests already protecting request-validation behavior.
- Reusing `@evenup/shared`'s Zod schemas via `z.toJSONSchema()` for the request
  bodies keeps the spec honest without a second, hand-maintained copy of every
  field's type/constraints.

## Consequences

- All business endpoints now live under `/api/v1/*`; only `/api/health` and
  `/api/docs*` remain unversioned. Any client hitting the old bare `/api/groups`
  etc. now gets a `404` (verified in `apps/api/src/tests/openapi.test.ts`).
- `docs/api-reference.md`, `README.md`, `docs/architecture.md`, the E2E test
  route-interception patterns (`apps/e2e/helpers/mockAuth.ts`,
  `apps/e2e/tests/*.spec.ts`), and the CI smoke test's `/api/auth/me` check were
  all updated to the new `/api/v1/...` paths.
- The OpenAPI spec's request-body accuracy is coupled to the shared Zod schemas
  actually being kept in `@evenup/shared` — if a future endpoint's validation
  schema is defined locally instead of exported, its request body in the spec
  will need to be hand-written (and hand-maintained) like the auth endpoints are
  today, rather than generated automatically.
- Response bodies in the spec are still hand-described (matching
  `docs/api-reference.md`'s examples) rather than derived from a schema, since
  responses are plain object literals returned from handlers, not validated
  against any schema at all.
