import Fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { env } from './env.js';
import { openApiDocument } from './openapi.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRoutes } from './routes/auth.js';
import { groupsRoutes } from './routes/groups.js';
import { expensesRoutes } from './routes/expenses.js';
import { settlementRoutes } from './routes/settlements.js';
import { inviteRoutes } from './routes/invites.js';
import { activityRoutes } from './routes/activities.js';
import { joinRequestsRoutes } from './routes/joinRequests.js';
import { receiptRoutes } from './routes/receipts.js';

function getAllowedOrigins(): string[] {
  if (env.CORS_ORIGIN) return env.CORS_ORIGIN.split(',').map((o) => o.trim());
  return [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:4173',
    'http://localhost:4174',
  ];
}

export function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  const allowedOrigins = getAllowedOrigins();
  // API serves JSON only — CSP not applicable, all other headers enabled.
  app.register(helmet, { contentSecurityPolicy: false });

  app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });
  app.register(cookie);
  app.register(compress);
  app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  app.setErrorHandler(errorHandler);

  // Static-mode OpenAPI doc — the spec below is hand-authored (reusing the real Zod
  // schemas from @evenup/shared for request bodies) rather than auto-generated from
  // per-route `schema:` options, so adding Swagger never touches how routes actually
  // validate requests. Served unversioned at /api/docs, like /api/health, since it
  // describes the API rather than being part of it — see ADR 014.
  app.register(swagger, { mode: 'static', specification: { document: openApiDocument } });
  app.register(swaggerUi, { routePrefix: '/api/docs' });

  // /api/health is intentionally unversioned — it's an infra-facing liveness probe
  // (Docker healthcheck, uptime monitoring), not part of the versioned client API
  // contract, so it never needs to change shape alongside a version bump.
  app.get('/api/health', async () => ({ status: 'ok' }));

  const API_PREFIX = '/api/v1';
  app.register(authRoutes, { prefix: `${API_PREFIX}/auth` });
  app.register(groupsRoutes, { prefix: `${API_PREFIX}/groups` });
  app.register(expensesRoutes, { prefix: API_PREFIX });
  app.register(settlementRoutes, { prefix: API_PREFIX });
  app.register(inviteRoutes, { prefix: API_PREFIX });
  app.register(activityRoutes, { prefix: API_PREFIX });
  app.register(joinRequestsRoutes, { prefix: API_PREFIX });
  app.register(receiptRoutes, { prefix: API_PREFIX });

  return app;
}
