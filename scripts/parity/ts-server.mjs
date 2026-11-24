// Starts the legacy TypeScript server for scripts/parity.mjs.
//
// usage: node scripts/parity/ts-server.mjs <port> <path-to-dist/index.js>
//
// The Rust side is started through its real CLI (`clover serve`), so the two
// processes only share the environment contract: a home directory and a token
// secret. Everything else (routes, stores, ACP) comes from each implementation.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const port = Number(process.argv[2]);
const distEntry = process.argv[3];

if (!port || !distEntry) {
  console.error('usage: ts-server.mjs <port> <dist/index.js>');
  process.exit(2);
}

// The tsup ESM bundle resolves `node-pty` through a `new Function('return
// require')` fallback that also probes `import.meta`; `new Function` rejects
// `import.meta` outright, so PTYs fail in the bundle. Expose a `require`
// anchored at the legacy package instead — the same branch a CJS host takes.
globalThis.require ??= createRequire(distEntry);

const { createServer } = await import(pathToFileURL(distEntry).href);

const server = createServer({
  port,
  corsAllowAnyOrigin: true,
  tokenSecret: process.env.CLOVER_TOKEN_SECRET,
  logPrefix: '[parity-ts]',
});

server.httpServer.on('listening', () => {
  console.log(`PARITY_READY ${port}`);
});

function shutdown() {
  server.httpServer.close(() => process.exit(0));
  // Sockets held open by SSE/WS must not keep the harness waiting.
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);