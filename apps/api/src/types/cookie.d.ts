// @fastify/cookie v11 has no `exports` field so NodeNext does not auto-apply its
// module augmentations. Re-declare the subset we use here.
import type { CookieSerializeOptions } from '@fastify/cookie';

declare module 'fastify' {
  interface FastifyRequest {
    cookies: { [cookieName: string]: string | undefined };
  }
  interface FastifyReply {
    cookies: { [cookieName: string]: string | undefined };
    setCookie(name: string, value: string, options?: CookieSerializeOptions): this;
    clearCookie(name: string, options?: CookieSerializeOptions): this;
  }
}
