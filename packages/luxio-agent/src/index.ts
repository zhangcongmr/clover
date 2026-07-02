#!/usr/bin/env node

import { resolve } from 'node:path';
import { AgentServer } from './server.js';
import type { AgentConfig } from './protocol.js';

function parseArgs(): AgentConfig {
  const args = process.argv.slice(2);
  const config: AgentConfig = {
    port: 9120,
    host: '127.0.0.1',
    workspacePath: process.cwd(),
    readonly: false,
    tokenTTL: 30
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port':
      case '-p':
        config.port = parseInt(args[++i], 10) || 9120;
        break;
      case '--workspace':
      case '-w':
        config.workspacePath = resolve(args[++i]);
        break;
      case '--host':
        config.host = args[++i] || '127.0.0.1';
        break;
      case '--readonly':
        config.readonly = true;
        break;
      case '--token-secret':
        config.tokenSecret = args[++i];
        break;
      case '--token-ttl':
        config.tokenTTL = parseInt(args[++i], 10) || 30;
        break;
      case '--allowed-origins':
        config.allowedOrigins = args[++i].split(',');
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
    }
  }

  return config;
}

function printUsage() {
  console.log(`
luxio-agent - Local proxy agent for Luxio Web App

Usage:
  luxio-agent [options]

Options:
  -p, --port <number>        Port to listen on (default: 9120)
  -w, --workspace <path>     Workspace root path (default: cwd)
  --host <address>           Host to bind (default: 127.0.0.1)
  --readonly                 Enable read-only mode
  --token-secret <secret>    Secret for token signing
  --token-ttl <seconds>      Token TTL in seconds (default: 30)
  --allowed-origins <list>   Comma-separated allowed origins
  -h, --help                 Show this help

Examples:
  luxio-agent --workspace "C:\\Users\\me\\my-project"
  luxio-agent -p 9200 -w /home/me/project --readonly
  `);
}

async function main() {
  const config = parseArgs();
  const server = new AgentServer(config);

  process.on('SIGINT', async () => {
    console.log('\n[luxio-agent] Shutting down...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });

  await server.start();
}

main().catch((err) => {
  console.error('[luxio-agent] Fatal error:', err);
  process.exit(1);
});
