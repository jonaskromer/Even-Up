import { z } from 'zod';
import type { OpenAPIV3 } from 'openapi-types';
import {
  createExpenseSchema,
  updateExpenseSchema,
  createGroupSchema,
  addMemberSchema,
  createSettlementSchema,
  createReceiptExpenseSchema,
  updateReceiptExpenseSchema,
} from '@evenup/shared';

// Reuses the actual Zod schemas already enforced at runtime (via `@evenup/shared`)
// wherever one exists, converted through Zod v4's native `z.toJSONSchema()` — the
// request-body shapes documented here can never silently drift from what the API
// really validates. Endpoints validated by a schema defined locally inside a route
// file (auth: login/register/etc.) are hand-described instead, matching
// docs/api-reference.md's examples, since those schemas aren't exported for reuse.
function schema(zodSchema: z.ZodType): OpenAPIV3.SchemaObject {
  const json = z.toJSONSchema(zodSchema) as Record<string, unknown>;
  delete json.$schema;
  return json as OpenAPIV3.SchemaObject;
}

const errorResponse: OpenAPIV3.SchemaObject = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    details: { type: 'object', additionalProperties: true },
  },
  required: ['error'],
};

function errorRef(description: string): OpenAPIV3.ResponseObject {
  return {
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  };
}

const jsonBody = (
  s: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
): OpenAPIV3.RequestBodyObject => ({
  required: true,
  content: { 'application/json': { schema: s } },
});

const jsonOk = (
  description: string,
  s?: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
): OpenAPIV3.ResponseObject => ({
  description,
  ...(s ? { content: { 'application/json': { schema: s } } } : {}),
});

const cookieAuth: OpenAPIV3.SecurityRequirementObject[] = [{ cookieAuth: [] }];

export const openApiDocument: OpenAPIV3.Document = {
  openapi: '3.0.3',
  info: {
    title: 'Even-Up API',
    description:
      'REST API for Even-Up, a group-expense-splitting app. All mutating endpoints validate ' +
      'input with the Zod schemas shown here (shared verbatim with the frontend via ' +
      '`@evenup/shared`). Auth is entirely cookie-based (see the `sb_access`/`sb_refresh` ' +
      'HttpOnly cookies) — there is no API-key or bearer-token flow for browser clients. ' +
      'See `docs/api-reference.md` in the repository for narrative documentation and ' +
      '`docs/adr/` for the design rationale behind specific endpoints.',
    version: 'v1',
  },
  servers: [
    {
      url: '/api/v1',
      description: "Versioned API root (this document's paths are relative to it)",
    },
  ],
  tags: [
    { name: 'Health', description: 'Unversioned infra liveness probe' },
    { name: 'Auth', description: 'Session management via the Fastify BFF' },
    { name: 'Groups' },
    { name: 'Join Requests' },
    { name: 'Expenses' },
    { name: 'Settlements' },
    { name: 'Receipts', description: 'AI-assisted (Gemini) receipt-to-expense flow' },
    { name: 'Invites', description: 'Link-based group invites' },
    { name: 'Activities' },
  ],
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'sb_access',
        description:
          'HttpOnly session cookie set by /auth/login, /auth/register, or the OAuth/passkey ' +
          'exchange flows. Never accessible from JavaScript. A parallel `sb_refresh` cookie ' +
          '(30 days) is used transparently by the server to reissue an expired `sb_access`.',
      },
    },
    schemas: {
      Error: errorResponse,
      CreateExpense: schema(createExpenseSchema),
      UpdateExpense: schema(updateExpenseSchema),
      CreateGroup: schema(createGroupSchema),
      AddMember: schema(addMemberSchema),
      CreateSettlement: schema(createSettlementSchema),
      CreateReceiptExpense: schema(createReceiptExpenseSchema),
      UpdateReceiptExpense: schema(updateReceiptExpenseSchema),
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Liveness probe',
        description:
          'Deliberately unversioned in production — reachable at `/api/health`, not ' +
          '`/api/v1/health` — since it is an infra-facing endpoint (Docker healthcheck, uptime ' +
          'monitoring), not part of this versioned client API contract.',
        security: [],
        responses: {
          '200': jsonOk('OK', {
            type: 'object',
            properties: { status: { type: 'string', example: 'ok' } },
          }),
        },
      },
    },

    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new account',
        security: [],
        requestBody: jsonBody({
          type: 'object',
          required: ['name', 'email', 'password'],
          properties: {
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 6 },
            lang: { type: 'string', enum: ['de', 'en'] },
          },
        }),
        responses: {
          '200': jsonOk('Account created; cookies set unless email confirmation is required', {
            type: 'object',
            properties: { needsEmailConfirmation: { type: 'boolean' } },
          }),
          '422': errorRef('Email already registered, or a Supabase signup error'),
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Email/password login',
        security: [],
        requestBody: jsonBody({
          type: 'object',
          required: ['email', 'password'],
          properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } },
        }),
        responses: {
          '200': jsonOk('Sets sb_access/sb_refresh cookies', {
            type: 'object',
            properties: { ok: { type: 'boolean' } },
          }),
          '401': errorRef('Invalid credentials'),
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Clear session cookies',
        security: cookieAuth,
        responses: { '204': { description: 'No content' } },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Refresh the access token using the sb_refresh cookie',
        security: cookieAuth,
        responses: {
          '200': jsonOk('New cookies set', {
            type: 'object',
            properties: { ok: { type: 'boolean' } },
          }),
          '401': errorRef('No refresh cookie or session expired (cookies cleared)'),
        },
      },
    },
    '/auth/google': {
      get: {
        tags: ['Auth'],
        summary: 'Start server-side PKCE Google OAuth flow',
        security: [],
        responses: { '302': { description: 'Redirect to the Supabase Google OAuth URL' } },
      },
    },
    '/auth/callback': {
      get: {
        tags: ['Auth'],
        summary: 'Google OAuth PKCE callback',
        security: [],
        parameters: [{ name: 'code', in: 'query', required: true, schema: { type: 'string' } }],
        responses: {
          '302': {
            description: "Redirect to '/' on success, '/login?error=oauth_failed' on failure",
          },
        },
      },
    },
    '/auth/exchange': {
      post: {
        tags: ['Auth'],
        summary: 'Exchange a client-side token pair (e.g. passkey sign-in) for session cookies',
        security: [],
        requestBody: jsonBody({
          type: 'object',
          required: ['access_token', 'refresh_token'],
          properties: { access_token: { type: 'string' }, refresh_token: { type: 'string' } },
        }),
        responses: {
          '200': jsonOk('Cookies set', { type: 'object', properties: { ok: { type: 'boolean' } } }),
          '401': errorRef('Invalid token'),
        },
      },
    },
    '/auth/forgot-password': {
      post: {
        tags: ['Auth'],
        summary: 'Send a password-reset email',
        description:
          'Always returns 200 regardless of whether the email exists (no user enumeration).',
        security: [],
        requestBody: jsonBody({
          type: 'object',
          required: ['email'],
          properties: { email: { type: 'string', format: 'email' } },
        }),
        responses: {
          '200': jsonOk('OK', { type: 'object', properties: { ok: { type: 'boolean' } } }),
        },
      },
    },
    '/auth/session-tokens': {
      get: {
        tags: ['Auth'],
        summary: "Expose the current session's tokens (WebAuthn passkey enrollment only)",
        security: cookieAuth,
        responses: {
          '200': jsonOk('OK', {
            type: 'object',
            properties: { access_token: { type: 'string' }, refresh_token: { type: 'string' } },
          }),
          '401': errorRef('No active session'),
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Current user profile',
        security: cookieAuth,
        responses: {
          '200': jsonOk('OK', {
            type: 'object',
            properties: {
              user: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  name: { type: 'string' },
                  defaultMarkupRate: { type: 'number' },
                },
              },
            },
          }),
          '401': errorRef('No valid session cookie'),
        },
      },
      patch: {
        tags: ['Auth'],
        summary: 'Update name, language, preferred currency, and/or default markup rate',
        security: cookieAuth,
        requestBody: jsonBody({
          type: 'object',
          minProperties: 1,
          properties: {
            name: { type: 'string' },
            lang: { type: 'string', enum: ['de', 'en'] },
            preferredCurrency: { type: 'string', minLength: 3, maxLength: 3 },
            defaultMarkupRate: { type: 'number', minimum: 0, maximum: 100 },
          },
        }),
        responses: {
          '200': jsonOk('Updated (only when a locally-stored field changed)'),
          '204': { description: "No content (only 'lang' was set, synced to Supabase only)" },
        },
      },
      delete: {
        tags: ['Auth'],
        summary: "Delete the authenticated user's account and all their data",
        security: cookieAuth,
        responses: {
          '204': { description: 'No content' },
          '409': errorRef('User has shared financial records other members depend on'),
        },
      },
    },
    '/auth/change-password': {
      post: {
        tags: ['Auth'],
        summary: "Change the authenticated user's password",
        security: cookieAuth,
        requestBody: jsonBody({
          type: 'object',
          required: ['password'],
          properties: { password: { type: 'string', minLength: 6 } },
        }),
        responses: {
          '200': jsonOk('OK', { type: 'object', properties: { ok: { type: 'boolean' } } }),
          '400': errorRef('Weak password'),
          '401': errorRef('Not authenticated'),
        },
      },
    },

    '/groups': {
      get: {
        tags: ['Groups'],
        summary: 'List the authenticated user’s groups',
        security: cookieAuth,
        responses: { '200': jsonOk('OK', { type: 'array', items: { type: 'object' } }) },
      },
      post: {
        tags: ['Groups'],
        summary: 'Create a group (creator becomes owner)',
        security: cookieAuth,
        requestBody: jsonBody({ $ref: '#/components/schemas/CreateGroup' }),
        responses: { '201': jsonOk('Created') },
      },
    },
    '/groups/{id}': {
      get: {
        tags: ['Groups'],
        summary: 'Group detail (members, currency, receiptsEnabled)',
        security: cookieAuth,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': jsonOk('OK'),
          '403': errorRef('Not a member'),
          '404': errorRef('Group not found'),
        },
      },
    },
    '/groups/{id}/members': {
      post: {
        tags: ['Groups'],
        summary: 'Invite a member by email (creates a pending join request)',
        security: cookieAuth,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: jsonBody({ $ref: '#/components/schemas/AddMember' }),
        responses: {
          '201': jsonOk('Join request created'),
          '404': errorRef('User with that email not found'),
          '409': errorRef('Already a member, or a request is already pending'),
        },
      },
    },
    '/groups/{id}/balances': {
      get: {
        tags: ['Groups'],
        summary: 'Net balance per member',
        security: cookieAuth,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonOk('OK', { type: 'array', items: { type: 'object' } }) },
      },
    },
    '/groups/{id}/join-requests': {
      get: {
        tags: ['Join Requests'],
        summary: 'Pending outgoing invites for a group',
        security: cookieAuth,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonOk('OK', { type: 'array', items: { type: 'object' } }) },
      },
    },
    '/join-requests': {
      get: {
        tags: ['Join Requests'],
        summary: "Current user's pending incoming requests, across all groups",
        security: cookieAuth,
        responses: { '200': jsonOk('OK', { type: 'array', items: { type: 'object' } }) },
      },
    },
    '/join-requests/{id}/accept': {
      post: {
        tags: ['Join Requests'],
        summary: 'Accept a pending join request',
        security: cookieAuth,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': jsonOk('Joined'),
          '403': errorRef('Not the invited user'),
          '404': errorRef('Not found'),
          '409': errorRef('Already responded to'),
        },
      },
    },
    '/join-requests/{id}/decline': {
      post: {
        tags: ['Join Requests'],
        summary: 'Decline a pending join request',
        security: cookieAuth,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonOk('Declined') },
      },
    },

    '/groups/{groupId}/expenses': {
      get: {
        tags: ['Expenses'],
        summary: 'List expenses (paginated)',
        security: cookieAuth,
        parameters: [
          { name: 'groupId', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
        ],
        responses: {
          '200': jsonOk('OK', {
            type: 'object',
            properties: {
              items: { type: 'array', items: { type: 'object' } },
              total: { type: 'integer' },
            },
          }),
        },
      },
      post: {
        tags: ['Expenses'],
        summary: 'Create an expense (splits computed/validated server-side)',
        security: cookieAuth,
        parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: jsonBody({ $ref: '#/components/schemas/CreateExpense' }),
        responses: {
          '201': jsonOk('Created'),
          '422': errorRef('Split validation failed (bad sum, non-member, duplicate)'),
          '503': errorRef('Exchange rate unavailable (foreign-currency expense only)'),
        },
      },
    },
    '/groups/{groupId}/expenses/export': {
      get: {
        tags: ['Expenses'],
        summary: 'Export every expense + its splits as CSV',
        description:
          'Wide, Splitwise-style CSV: `Date,Description,Cost` then one net-balance column per ' +
          'member, keyed by email — the same format expense import reads. Excludes receipt ' +
          'line items. See ADR 013.',
        security: cookieAuth,
        parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'CSV file (Content-Disposition: attachment)',
            content: { 'text/csv': { schema: { type: 'string' } } },
          },
          '403': errorRef('Not a member'),
        },
      },
    },
    '/groups/{groupId}/expenses/{expenseId}': {
      get: {
        tags: ['Expenses'],
        summary:
          'Single expense (includes lineItems/receiptStoreName for receipt-created expenses)',
        security: cookieAuth,
        parameters: [
          { name: 'groupId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'expenseId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': jsonOk('OK'), '404': errorRef('Not found') },
      },
      put: {
        tags: ['Expenses'],
        summary: 'Update an expense (optimistic concurrency via updatedAt)',
        security: cookieAuth,
        parameters: [
          { name: 'groupId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'expenseId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: jsonBody({ $ref: '#/components/schemas/UpdateExpense' }),
        responses: {
          '200': jsonOk('Updated'),
          '409': errorRef('updatedAt mismatch (concurrent edit)'),
          '422': errorRef('Split validation failed'),
          '503': errorRef('Exchange rate unavailable'),
        },
      },
      delete: {
        tags: ['Expenses'],
        summary: 'Delete an expense and its splits',
        security: cookieAuth,
        parameters: [
          { name: 'groupId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'expenseId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '204': { description: 'No content' } },
      },
    },

    '/groups/{groupId}/settlements': {
      get: {
        tags: ['Settlements'],
        summary: 'List recorded settlements',
        security: cookieAuth,
        parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonOk('OK', { type: 'array', items: { type: 'object' } }) },
      },
      post: {
        tags: ['Settlements'],
        summary: 'Record a payment between two members',
        security: cookieAuth,
        parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: jsonBody({ $ref: '#/components/schemas/CreateSettlement' }),
        responses: { '201': jsonOk('Created') },
      },
    },
    '/groups/{groupId}/settlements/{settlementId}': {
      put: {
        tags: ['Settlements'],
        summary: 'Update a settlement',
        security: cookieAuth,
        parameters: [
          { name: 'groupId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'settlementId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: jsonBody({ $ref: '#/components/schemas/CreateSettlement' }),
        responses: { '200': jsonOk('Updated'), '404': errorRef('Not found in this group') },
      },
      delete: {
        tags: ['Settlements'],
        summary: 'Delete a settlement',
        security: cookieAuth,
        parameters: [
          { name: 'groupId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'settlementId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '204': { description: 'No content' },
          '404': errorRef('Not found in this group'),
        },
      },
    },
    '/groups/{groupId}/settle-up': {
      get: {
        tags: ['Settlements'],
        summary: 'Suggested transfers to settle all debts',
        security: cookieAuth,
        parameters: [
          { name: 'groupId', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'simplify',
            in: 'query',
            schema: { type: 'boolean', default: true },
            description: 'Greedy min-cash-flow simplification',
          },
        ],
        responses: { '200': jsonOk('OK', { type: 'array', items: { type: 'object' } }) },
      },
    },

    '/groups/{groupId}/receipts/parse': {
      post: {
        tags: ['Receipts'],
        summary: 'Upload a receipt image for Gemini OCR extraction',
        description:
          'Response is `application/x-ndjson`, not a single JSON object — one `{"type":' +
          '"progress"|"result"|"error", ...}` line per event, streamed as the primary/secondary ' +
          'model retries happen. See ADR 012.',
        security: cookieAuth,
        parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: { file: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'NDJSON stream of progress/result/error events',
            content: { 'application/x-ndjson': { schema: { type: 'string' } } },
          },
          '400': errorRef('No file, or unsupported MIME type'),
          '404': errorRef('Receipt parsing not enabled (GEMINI_API_KEY unset)'),
        },
      },
    },
    '/groups/{groupId}/receipts': {
      post: {
        tags: ['Receipts'],
        summary: 'Create one expense from reviewed receipt line items',
        security: cookieAuth,
        parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: jsonBody({ $ref: '#/components/schemas/CreateReceiptExpense' }),
        responses: {
          '201': jsonOk('Created'),
          '422': errorRef('Bad per-item sums, or a non-member assignment'),
        },
      },
    },
    '/groups/{groupId}/receipts/{expenseId}': {
      put: {
        tags: ['Receipts'],
        summary: "Replace a receipt-expense's line items and splits",
        security: cookieAuth,
        parameters: [
          { name: 'groupId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'expenseId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: jsonBody({ $ref: '#/components/schemas/UpdateReceiptExpense' }),
        responses: {
          '200': jsonOk('Updated'),
          '404': errorRef('Not found'),
          '409': errorRef('updatedAt mismatch (concurrent edit)'),
          '422': errorRef('Bad per-item sums, or a non-member assignment'),
        },
      },
    },

    '/groups/{id}/invites': {
      post: {
        tags: ['Invites'],
        summary: 'Generate a shareable invite link (7-day expiry)',
        security: cookieAuth,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '201': jsonOk('OK', {
            type: 'object',
            properties: {
              token: { type: 'string' },
              expiresAt: { type: 'string', format: 'date-time' },
            },
          }),
        },
      },
    },
    '/invites/{token}/accept': {
      post: {
        tags: ['Invites'],
        summary: 'Accept an invite and join the group',
        security: cookieAuth,
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': jsonOk('Already a member'),
          '201': jsonOk('Joined'),
          '404': errorRef('Token invalid or expired'),
        },
      },
    },

    '/activities': {
      get: {
        tags: ['Activities'],
        summary: "Activity events across all of the user's groups (paginated)",
        security: cookieAuth,
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
        ],
        responses: {
          '200': jsonOk('OK', {
            type: 'object',
            properties: {
              items: { type: 'array', items: { type: 'object' } },
              total: { type: 'integer' },
            },
          }),
        },
      },
    },
    '/groups/{groupId}/activities': {
      get: {
        tags: ['Activities'],
        summary: 'Activity events for a group (paginated)',
        security: cookieAuth,
        parameters: [
          { name: 'groupId', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
        ],
        responses: {
          '200': jsonOk('OK', {
            type: 'object',
            properties: {
              items: { type: 'array', items: { type: 'object' } },
              total: { type: 'integer' },
            },
          }),
        },
      },
    },
  },
};
