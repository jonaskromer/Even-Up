# ADR 009: Offset-Based Load-More Pagination for Expenses and Activities

## Status

Accepted

## Context

The `GET /api/groups/:groupId/expenses` and `GET /api/groups/:groupId/activities` endpoints
originally returned the full dataset in a single response (expenses: unbounded; activities:
hard-capped at 50). In active groups with many entries, this becomes a progressively slower
query and an ever-larger JSON response — both the DB read and the network transfer grow
linearly with the group's history.

Two pagination styles were considered:

1. **Cursor-based pagination** — each page carries an opaque cursor (e.g. the last item's
   `id` or `createdAt`) that the next request submits to retrieve the following page.
   Cursor pagination is stable under concurrent writes: inserts between pages don't cause
   duplicate or skipped items. It is the right choice for infinite-scroll feeds where the
   user never jumps to a specific page.

2. **Offset-based pagination** — clients supply `limit` and `offset` integers. The database
   uses `TAKE`/`SKIP`. Simple to implement, easy to reason about, supports arbitrary "jump
   to position N" access.

For the load-more UX on expense feeds and activity logs:

- Users scroll linearly downward, never jump to a specific page.
- The dataset changes rarely while the user is viewing (expenses are low-frequency writes).
- For expenses, a secondary sort by `id DESC` was added alongside `date DESC` to produce a
  stable ordering when multiple expenses share the same date, preventing reordering between
  pages.
- The simplicity benefit of offset pagination outweighs the edge-case stability benefit of
  cursor pagination for these access patterns.

## Decision

Use **offset-based pagination** with a **load-more button** UI.

- Both endpoints accept `?limit=N&offset=N` (limit: 1–100, default 20).
- Both endpoints return `{ items: [...], total: N }` instead of a bare array.
- `total` is computed in parallel via `prisma.*.count()` with no additional cost.
- The `clientLoader` fetches the first page (`limit=20&offset=0`).
- `ExpenseFeed` and `ActivityLog` maintain a local `extra` state (accumulated load-more pages).
  `allExpenses = [...initialExpenses, ...extra]`; `hasMore = allExpenses.length < total`.
- A "Load more" button appears when `hasMore` is true.

## Key Pattern: `key` Prop for Page Reset

After a mutation (create/edit/delete expense, or a new settlement that generates activity),
the parent route calls `revalidator.revalidate()`. The `clientLoader` re-fetches the first
page, returning updated `initialExpenses` and a new `expensesTotal`. Without intervention,
the component's stale `extra` state would still be appended, showing a mix of old and new
data.

Using `useEffect` to clear `extra` on prop change is prohibited by the
`react-hooks/set-state-in-effect` ESLint rule (ADR 007). Using a `useRef` to track
the previous total violates the `react-hooks/refs` rule (refs must not be read/written
during render).

**Solution:** `key={ef-${expensesTotal}-${firstItemId}}` on `<ExpenseFeed>` and
`key={al-${activitiesTotal}-${firstActivityId}}` on `<ActivityLog>`. When the key changes
(because `total` or the first item changes after a CRUD operation), React unmounts and
remounts the component, giving it a fresh empty `extra` state — no extra effect, no ref.

## Rationale

- **Simplicity.** Offset pagination is four lines of Zod schema and two Prisma clauses.
  The counter display (`shown von total`) required for the load-more UX needs `total` anyway.
- **Correctness for the access pattern.** Expense/activity lists are append-mostly. The
  primary consistency risk (inserting a row that shifts earlier offsets) only affects the
  "load more" scenario, and the visual effect is at most one duplicated or skipped item —
  acceptable for non-financial display data.
- **No breaking change.** Clients that previously consumed the bare array (tests, any
  external tooling) will see a 400 if they pass unexpected query params, but the route
  now returns `{ items, total }` — callers that destructured the array response need to
  be updated. The test for `GET /expenses` was updated accordingly.

## Consequences

- `GET /api/groups/:groupId/expenses` and `GET /api/groups/:groupId/activities` no longer
  return bare arrays; they return `{ items, total }`. All callers must destructure `.items`.
- The hard `take: 50` cap on activities is removed; the default `limit=20` applies instead.
  Clients wanting more than 20 can pass `?limit=100` (the enforced maximum per request).
- `expensesTotal` and `activitiesTotal` flow from `clientLoader` through `GroupDetailRoute`
  → `GroupDetail` → `ExpenseFeed` / `ActivityLog` as explicit props.
- Pagination translations were added to `apps/web/app/i18n/translations.ts` under the
  `pagination` key (`loadMore`, `loading`, `showing`).
