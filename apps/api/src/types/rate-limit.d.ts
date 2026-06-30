// @fastify/rate-limit v11 has no `exports` field, so NodeNext resolution does not
// auto-apply its module augmentation. Re-declare it here so route-level
// `config: { rateLimit: { ... } }` is accepted by TypeScript.
import type { RateLimitOptions } from '@fastify/rate-limit';

declare module 'fastify' {
  interface FastifyContextConfig {
    rateLimit?: RateLimitOptions | false;
  }
}
