# @julyware/clover-server (legacy)

> **Frozen.** This is the original TypeScript implementation of the Clover local
> server (Express + `ws` + `node-pty` + `@a2a-js/sdk`). The production server now
> lives in [`packages/server-rust`](../server-rust) as the `clover-server` crate
> (axum + `portable-pty` + in-crate A2A), and ships as the `clover` (CLI) and
> `clover-app` (desktop) binaries.
>
> The package stays in the workspace — and on npm — for one release cycle so
> existing consumers can roll back. It receives no new features. After that
> cycle it will be removed together with this directory.

## Why it is still here

- `packages/assistant` and `packages/clover` still import
  `createServer` / `setupServerMiddleware` from it for their legacy entry points.
- `scripts/parity.mjs` runs it side by side with the Rust server and diffs both
  implementations field by field.

## Commands

```bash
pnpm --filter ./packages/server-legacy build   # tsup → dist/
pnpm --filter ./packages/server-legacy dev     # watch build
pnpm --filter ./packages/server-legacy test    # vitest (CLI tests)
```

## Dev-server cache (important)

`ng serve` pre-bundles this package for the SSR entry
(`src/server.ts`) into `.angular/cache/<version>/<project>/vite/deps_ssr/`.
Vite keys that cache by the lockfile/config, **not** by the contents of a linked
workspace package, so after rebuilding `dist/` the dev server keeps serving the
old code until the cache is dropped:

```bash
pnpm --filter ./packages/assistant exec ng cache clean   # then restart ng serve
```

The behavioural contract and every intentional divergence from the Rust port
are recorded in [`docs/rust-server-migration-plan.md`](../../docs/rust-server-migration-plan.md).