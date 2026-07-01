import Fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { env } from './env.js';
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

  app.get('/api/health', async () => ({ status: 'ok' }));

  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(groupsRoutes, { prefix: '/api/groups' });
  app.register(expensesRoutes, { prefix: '/api' });
  app.register(settlementRoutes, { prefix: '/api' });
  app.register(inviteRoutes, { prefix: '/api' });
  app.register(activityRoutes, { prefix: '/api' });
  app.register(joinRequestsRoutes, { prefix: '/api' });
  app.register(receiptRoutes, { prefix: '/api' });

  return app;
}
