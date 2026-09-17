export { createRestaurantServer } from './server.js';
export type { RestaurantServerOptions } from './server.js';

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createRestaurantServer } from './server.js';

const isMainModule = process.argv[1]?.includes('index') ||
                     process.argv[1]?.includes('restaurant');

if (isMainModule) {
  console.error('[Restaurant MCP] Starting in stdio mode...');
  void serveStdio(() => createRestaurantServer());
}
