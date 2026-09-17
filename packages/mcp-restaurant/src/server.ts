import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface RestaurantServerOptions {
  dataPath?: string;
}

declare const __dirname: string;

export function createRestaurantServer(options?: RestaurantServerOptions): McpServer {
  const server = new McpServer({
    name: 'restaurant-finder',
    version: '1.0.0',
  });

  server.registerTool(
    'get_restaurants',
    {
      description: 'Get a list of restaurants based on cuisine and location',
      inputSchema: z.object({
        cuisine: z.string().describe('Type of cuisine (e.g., chinese, italian)'),
        location: z.string().describe('Location to search (e.g., new york)'),
        count: z.number().optional().default(5).describe('Number of restaurants to return'),
      }),
    },
    async ({ cuisine, location, count = 5 }) => {
      console.error(`[Restaurant MCP] Getting restaurants: ${cuisine} in ${location}, count: ${count}`);

      const dataPath = options?.dataPath
        || process.env.RESTAURANT_DATA_PATH
        || join(__dirname, '..', 'data', 'restaurant_data.json');

      if (!existsSync(dataPath)) {
        return {
          content: [{ type: 'text', text: `Error: Data file not found at ${dataPath}` }],
          isError: true,
        };
      }

      const data = readFileSync(dataPath, 'utf-8');
      const allItems = JSON.parse(data);
      const items = allItems.slice(0, count);

      return {
        content: [{ type: 'text', text: JSON.stringify(items, null, 2) }],
      };
    }
  );

  return server;
}
