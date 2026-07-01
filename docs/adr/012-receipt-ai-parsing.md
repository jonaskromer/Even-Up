# ADR 012: Receipt Upload with AI Line-Item Parsing

## Status

Accepted

## Context

Splitting a shared receipt today means manually re-typing every line item's price and
working out who owes what by hand. Users asked for a way to photograph or upload a
receipt, have it OCR'd into structured line items, and assign each item to the group
members who consumed it (at an adjustable share) before saving a single expense with
correct per-user splits.

Requirements:
- A store name, and every line item (name, quantity, final gross price) must be
  extracted reliably from a photo, including receipts with net/gross tax breakdowns,
  per-item discounts, and ALL-CAPS item names.
- Per-item assignment must support both equal splitting among selected members and
  uneven shares (e.g. a double portion), and a line item must be excludable from the
  expense entirely (e.g. a cash-back/deposit line) without losing its data.
- Editing a receipt-originated expense later must offer the same per-item assignment
  UI, not just the flat "amount per person" edit every other expense gets.
- The receipt photo itself must never be persisted — OCR once, then discard.
- The feature must not become a hard dependency for running the app (grading/CI/local
  dev should work with zero extra configuration).

## Decision

### AI provider: Google Gemini, primary/secondary models configurable via env vars

The image is sent inline (base64) to Gemini's `generateContent` REST API with a vision
content part. Two model strings are configurable rather than hardcoded:
`GEMINI_MODEL_PRIMARY` (default `gemini-3.5-flash`) and `GEMINI_MODEL_SECONDARY`
(default `gemini-2.5-flash`), so either can be bumped without a code change. Both
defaults were verified directly against the Gemini API with vision input and
`responseSchema` structured output before settling on them.

### Retry-then-fallback on transient failures

The primary model is retried up to 3 times, with a random jitter delay (300–1200ms)
between attempts, before falling back to the secondary model once. This absorbs the
common case of a transient `503` (model overloaded) or network hiccup without ever
bothering the secondary model unnecessarily; the secondary is only used once the
primary has been given several chances to succeed. Only if both the retried primary
and the single fallback attempt fail does the endpoint surface a `503` to the client.

### Streamed retry/fallback progress (NDJSON over the same request)

With up to 3 retries plus a fallback attempt, a single parse can now take anywhere
from a couple of seconds to several minutes — a static "processing…" spinner gives no
signal about what's actually happening. Rather than adding a second connection (SSE,
WebSocket) or a polling status endpoint, `POST /receipts/parse` streams
newline-delimited JSON over the *same* request/response: `reply.hijack()` +
`reply.raw` write a `{type:'progress', model, attempt, attempts}` line before each
Gemini call, then a final `{type:'result', data}` or `{type:'error', status, message}`
line. The frontend reads `response.body` with a `ReadableStream` reader
(`postFileStream` in `apiClient.ts`), updating the processing screen's message live
("Retrying (2/3)…", "Using backup model…") as events arrive, and resolving/rejecting
based on the terminal event. This keeps the feature to one HTTP request with no new
infrastructure (no SSE library, no second endpoint to poll), at the cost of the
response no longer being a single parseable JSON body — callers must consume it as a
line stream.

### Native structured output over prompt-only JSON instructions

Rather than relying solely on prompt text ("return ONLY raw JSON, no backticks"), the
request sets `generationConfig.responseMimeType: "application/json"` and a
`responseSchema` matching the target shape. This constrains the model's output at
decode time, which is materially more robust than trusting the model not to wrap its
answer in markdown or commentary. The prompt's actual extraction rules (net/gross tax
reconciliation, discount subtraction, ALL-CAPS→Title-Case cleanup) are otherwise kept
as originally specified — they were already precise. Two additions were made: the
store name (used as the expense description) and the receipt date (prefills the
review screen's date field; omitted if not legible rather than guessed). Currency was
deliberately **not** added to the extraction — the group's base currency is already
known, and OCR misdetection of a currency symbol is a needless new failure mode for a
field with an already-correct manual default.

### No image persistence

The uploaded image travels browser → Fastify (`multipart/form-data`) → Gemini →
structured JSON response, then is discarded. No S3/Minio, no `image` column anywhere.
Re-entering the line-item editor later (see below) works from the already-extracted
structured data, not by re-uploading or re-OCRing the receipt.

### `@fastify/multipart` over base64-in-JSON for the upload transport

A phone photo (2–8MB) would inflate ~33% as base64, forcing a much larger global JSON
body limit and widening the blast radius for every other JSON endpoint. `@fastify/multipart`
scopes the larger size limit to just the upload route; the handler reads the stream
into a buffer, base64-encodes only in memory for the single outbound Gemini call, and
discards it immediately after.

### Normalized `ReceiptLineItem` / `ReceiptLineItemAssignment` tables, not JSON

Line items must be re-editable later (the "Edit line items" flow), which rules out
`Activity.data Json` as a precedent — that column is a write-once audit log, never
queried back for editing. Instead, two new tables mirror `ExpenseSplit`'s existing
normalized, cascade-deleted style:

- `ReceiptLineItem` (`expenseId` FK cascade, `name`, `quantity`, `priceCents`,
  `sortOrder`, `excluded`, `splitMode`).
- `ReceiptLineItemAssignment` (`lineItemId` FK cascade, `userId` — plain string, **no**
  FK to `User`, matching `ExpenseSplit.userId`'s existing convention so account
  deletion isn't blocked by receipt-assignment rows — `shareWeight`, `exactCents`,
  `percent`).

`shareWeight` is stored as an integer weight (default 1), not a pre-computed
`owedCents` amount. If the assignment stored cents directly, any later correction
would risk stale totals that no longer sum to the item price. Storing weights means
per-user cents are always *derived* at save/read time as
`priceCents × memberWeight / sum(weightsForThatItem)` — naturally idempotent, and
supports "one person ate it alone," "equal three-way split," and "double portion"
without special-casing. `exactCents`/`percent` are nullable siblings used only when
the item's `splitMode` is `'exact'`/`'percent'` respectively (see below).

Excluding a line item (`excluded: true`) keeps its row and assignments in the database
untouched — it simply contributes nothing to the expense total or any split. Toggling
it back on in the editor restores whatever assignment it had before, since nothing was
discarded.

### Per-item split modes: equal / exact / percent / shares

The initial version only supported a "shares" (weighted) split per item. Users asked
for the same four modes already available for the whole expense
(`expense.splitMode`: `equal`, `exact`, `percent`, `shares`), scoped to individual line
items — e.g. "this pizza: I paid exactly €7, they paid €3" rather than only
proportional weights. `ReceiptLineItem.splitMode` selects the mode; the mode-specific
value lives on the assignment (`shareWeight` for `'shares'`, `exactCents` for
`'exact'`, `percent` for `'percent'`; `'equal'` needs no extra value, it just divides
the item price by the assignee count). `computeSingleItemSplit` in `receipts.ts`
switches on this per item and validates each mode's invariant with the same tolerance
convention used elsewhere (`computeAndValidateSplits`'s `±memberCount` cents,
`±0.5` percentage points) — throwing `HttpError(422, ...)` naming the offending item
if `exact` amounts don't sum to the item price or `percent` values don't sum to 100.
The frontend's `lib/receiptSplits.ts` mirrors this exact computation (including the
"remainder to the last assignee" rounding convention) so the review screen's live
totals always match what the server will persist.

This intentionally does not reuse the top-level expense form's `SplitModeToggle`
component — that component's API is built around a single flat member list and a
`Record<userId, string>` input map, whereas each line item needs its own independent
mode, assignee subset, and price scope. The correctness-critical split math is shared
(mirrored) between `apps/api/src/routes/receipts.ts` and
`apps/web/app/lib/receiptSplits.ts`; the UI is a smaller, purpose-built rendering of
the same four modes rather than a forced reuse.

### Reuse of the existing exact-split pipeline, not a parallel one

`POST /api/groups/:groupId/receipts` and `PUT /api/groups/:groupId/receipts/:expenseId`
are new, dedicated endpoints (kept separate from `createExpenseSchema`/`expenses.ts` so
the plain expense path and its test suite are untouched). Internally, they aggregate
each line item's proportional per-user split into one `exactSplits`-shaped array, then
run it through the *unmodified* `resolveConvertedAmount` (currency conversion) and
`computeAndValidateSplits('exact', ...)` (non-member/duplicate/sum-tolerance
validation) functions already used by `expenses.ts`. This guarantees receipt-originated
expenses get identical currency-conversion, markup-rate, and validation behavior as
manually entered exact splits, with zero duplicated logic.

### Optional `GEMINI_API_KEY`, graceful degrade

`GEMINI_API_KEY` is optional, following the same pattern as `RESEND_API_KEY`. If
unset, `isReceiptParsingEnabled()` returns false, the parse endpoint 404s, and the
frontend hides the "Add Receipt" entry point (`Group.receiptsEnabled`). The app boots
and the Docker Compose "reproducibly startable" grading path works with zero extra
configuration.

### One routed screen with an internal state machine, not a modal

The frontend flow (`groups.$groupId_.receipt.tsx`) matches the app's existing
full-page-route pattern for expense creation rather than introducing a modal — no
shadcn `Dialog` primitive exists yet, and the closest existing analog
(`ImportExpensesButton`'s hand-rolled overlay) is for a much simpler flow. State
(`'upload' → 'processing' → 'review' → 'confirm'`) lives entirely client-side with no
URL changes between steps, so an in-progress capture isn't lost to back-navigation.
The final "confirm" step reuses the existing `AddExpenseForm` (via its `defaults`
prop) for payer/date/currency/markup editing, getting that functionality for free.

### `AddExpenseForm`'s `banner` slot for the "Edit line items" entry point

The edit page's "Edit line items" call-to-action was initially rendered in its own
`<div>` above `<AddExpenseForm>`, outside that component's own page header — it read as
a disconnected, easy-to-miss element rather than part of the page. `AddExpenseForm`
now accepts an optional `banner?: ReactNode` rendered between the page title and the
form card, so the edit route can pass an `Alert` with the "this expense came from a
receipt" hint and the edit-line-items button as a single, properly integrated part of
the page layout instead of a second ad-hoc header.

## Consequences

**Positive:**
- Users get a fast, camera-to-split workflow without manual re-typing.
- Line items remain fully editable later via the same UI used at creation time.
- Zero duplicated split/currency/markup validation logic — receipt expenses are
  ordinary `Expense` rows the rest of the app already knows how to render.
- The feature is entirely optional infrastructure — omitting `GEMINI_API_KEY` doesn't
  affect any other part of the app.

**Negative / trade-offs:**
- The Gemini API call is a hard external dependency for this one feature; a timeout or
  outage surfaces as a `503` with a "enter manually" fallback link, not a retry queue.
- `shareWeight`-based storage means every read of a receipt expense's line items must
  re-derive per-user cents rather than reading a stored amount directly — an
  intentional trade-off for editability over storage simplicity.
- The final "confirm" step's `AddExpenseForm` still exposes its own exact-split input
  UI (inherited, not hidden), but any edits made there are discarded in favor of the
  line-item-derived splits on save — a minor UX inconsistency accepted to avoid forking
  `AddExpenseForm` into a receipt-aware variant.

## Alternatives Considered

**Store `owedCents` directly on the assignment instead of a weight:**
Rejected — see the weight-based rationale above; would make re-editing risk stale,
non-summing totals.

**Extend `createExpenseSchema`/`expenses.ts` to accept an optional `lineItems` field:**
Rejected — would couple the plain expense path (and its fully-covered test suite) to
receipt-specific concerns for no benefit; a dedicated endpoint that reuses the
underlying split/currency functions gets the same guarantees with a cleaner boundary.

**Base64-encode the image directly in a JSON request body:**
Rejected — avoids one new dependency but requires raising the global JSON body limit
for a photo-sized payload, widening the blast radius for every other JSON endpoint.

**Prompt-only JSON output (no `responseSchema`):**
Rejected as the sole mechanism — kept as a description of the desired shape, but paired
with Gemini's native structured-output enforcement for reliability.
