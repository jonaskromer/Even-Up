import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../lib/HttpError.js';

export function errorHandler(err: FastifyError | Error, _req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof HttpError) {
    return reply.status(err.status).send({ error: err.message });
  }

  if (err instanceof ZodError) {
    return reply.status(400).send({
      error: 'Ungültige Eingabe',
      details: err.flatten().fieldErrors,
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return reply.status(409).send({ error: 'Eintrag existiert bereits' });
    }
    if (err.code === 'P2025') {
      return reply.status(404).send({ error: 'Nicht gefunden' });
    }
  }

  console.error('Unhandled error:', err.constructor?.name, err.message, err);
  return reply.status(500).send({ error: 'Interner Serverfehler' });
}
