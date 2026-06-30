# ADR 007: Upgrade to React Router v8, React 19, and Node.js 22

## Status

Accepted

## Context

The project was originally built on React Router v7, React 18, and Node.js 20. Three forces pushed an upgrade:

1. **Security CVEs in react-router 7.x.** The npm audit CI job added in M5 began reporting GHSA-8x6r and GHSA-84g9 (DoS and CSRF) against `react-router@7.x`. These were patched in v8.
2. **React 19 as the baseline for new tooling.** `eslint-plugin-react-hooks` v7 (the correct companion for the hooks ESLint rules) requires React 19. Running v7 of the plugin with React 18 produces a version mismatch warning and deactivates some rules.
3. **Node.js 20 EOL.** Node 20 reaches end-of-life in April 2026. Node 22 is the current LTS. CI and the Docker images should track an actively maintained LTS.

## Decision

Upgrade to **React Router v8**, **React 19**, and **Node.js 22** in a single coordinated change, together with **eslint-plugin-react-hooks v7**.

## Implementation Notes

### React dual-instance problem

`prisma studio` (a devDependency of Prisma) pulls in React 18 to the root `node_modules`. npm's hoisting algorithm resolves `@testing-library/react` against whichever `react` it finds there first, which was React 18 in CI even though `apps/web` declared React 19. Fix: add `react@^19` and `react-dom@^19` to the root `devDependencies` plus an `overrides` block, so npm hoists React 19 unconditionally.

### Cross-platform lockfile entries

The macOS-generated `package-lock.json` only contains the `@rollup/rollup-darwin-arm64` and `@esbuild/darwin-arm64` optional native binaries. Linux CI then fails with "Cannot find module @rollup/rollup-linux-x64-gnu". Fix: declare all Linux variants of rollup and esbuild as root `optionalDependencies`; reinstalling on macOS then populates both sets of entries in the lockfile so CI finds them on `npm ci`.

### eslint-plugin-react-hooks v7 violations

The new `react-hooks/set-state-in-effect` rule flags synchronous `setState` calls in `useEffect` bodies. Three violations required fixes:

- `SiteHeader.tsx` — replaced `useEffect` DOM read + `useState(false)` with a lazy initializer `useState(() => document.documentElement.classList.contains('dark'))`.
- `PendingInvitesContext.tsx` — removed sync `setRequests([])` in the `refetch` callback by replacing the raw state variable with derived state: `const requests = user ? rawRequests : []`.
- `SettleUpPanel.tsx` — `setLoading(true)` at the top of the data-fetch effect is a legitimate loading-indicator pattern; suppressed with a single targeted `eslint-disable-next-line`.

## Rationale

- Staying on React Router 7.x with active CVEs would block the `npm audit --audit-level=high` CI job permanently.
- Upgrading all three in one PR minimises the number of times the lockfile is regenerated from scratch; lockfile regeneration is the expensive and risky step.
- `eslint-plugin-react-hooks` v7 is the authoritative companion for React 19 and catches a real class of stale-closure / tearing bugs (synchronous state updates inside effects) that v5 ignored.

## Consequences

- `apps/api/Dockerfile` and `apps/web/Dockerfile` use `node:22-alpine`.
- All seven CI jobs use `node-version: 22`.
- The root `package.json` contains an `overrides` block and Linux optional-dependency entries — this is intentional and must not be removed.
- The `react-hooks/set-state-in-effect` rule is active; future effects must avoid synchronous `setState` calls (or use the lazy-initializer / derived-state patterns established above).
