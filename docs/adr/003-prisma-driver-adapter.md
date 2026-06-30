# ADR 003: Prisma 7 with Driver Adapter

## Status

Accepted

## Context

The project originally used Prisma 5 with the traditional query engine architecture. Prisma 5 bundles a Rust-based query engine binary that communicates with the database. Prisma 7 deprecates the `url` field in `datasource` blocks and requires either a **driver adapter** (direct database connection via a JS/TS driver) or **Prisma Accelerate** (managed connection pooling).

## Decision

Use **Prisma 7 with `@prisma/adapter-pg`** (the PostgreSQL driver adapter backed by the `pg` npm package).

## Changes from Prisma 5

| Aspect            | Prisma 5                                        | Prisma 7                                                                                                                   |
| ----------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Generator         | `prisma-client-js`                              | `prisma-client` with explicit `output` path                                                                                |
| Database URL      | `env("DATABASE_URL")` in `schema.prisma`        | `prisma.config.ts` → `datasource.url` for migrations                                                                       |
| Client connection | `new PrismaClient()` (reads env internally)     | `new PrismaClient({ adapter })` with `PrismaPg` adapter                                                                    |
| Query engine      | Rust binary (bundled)                           | None — queries go through the JS `pg` driver                                                                               |
| Generated output  | `node_modules/.prisma/client` (implicit)        | `src/generated/prisma` (explicit output path, gitignored — regenerated via `prisma generate` in dev, Docker build, and CI) |
| Import path       | `import { PrismaClient } from '@prisma/client'` | `import { PrismaClient } from '../generated/prisma/client.js'`                                                             |

## Rationale

- **No query engine binary.** The driver adapter eliminates the ~15 MB Rust binary from `node_modules`, reducing install size and removing a platform-specific dependency.
- **Standard PostgreSQL driver.** `pg` is the most widely used Node.js PostgreSQL client. Using it directly gives full control over connection pooling and configuration.
- **Future-proof.** Prisma 7 is the current major version. Staying on Prisma 5 would mean accumulating migration debt.

## File Layout

```
apps/api/
├── prisma.config.ts          # datasource URL for migrate/seed commands
├── prisma/
│   └── schema.prisma         # generator output → ../src/generated/prisma
└── src/
    ├── generated/prisma/     # generated Prisma Client (TypeScript)
    └── db/prisma.ts          # PrismaClient instance with PrismaPg adapter
```

## Consequences

- `prisma migrate dev` and `prisma db seed` require the `.env` file to be loaded. The `prisma.config.ts` handles this by parsing `.env` at config load time.
- The `npm run dev` script uses `--env-file=.env` (Node.js 22+ built-in) to load environment variables for the application runtime.
- All source files import from `../generated/prisma/client.js`, not from `@prisma/client`.
