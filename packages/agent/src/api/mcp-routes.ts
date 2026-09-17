import { Router, json } from 'express';
import { McpServerRegistry } from '../mcp/registry.js';
import type { McpServerConfig } from '../mcp/types.js';

export function createMcpRoutes(mcpRegistry: McpServerRegistry): Router {
  const router = Router();
  router.use(json());

  /**
   * GET /api/mcp/servers
   * 获取所有配置的 MCP servers
   */
  router.get('/servers', (req, res) => {
    const servers = mcpRegistry.list();
    res.json({ servers });
  });

  /**
   * GET /api/mcp/servers/:name
   * 获取单个 server 配置
   */
  router.get('/servers/:name', (req, res) => {
    const server = mcpRegistry.get(req.params.name);
    if (server) {
      res.json({ server });
    } else {
      res.status(404).json({ error: 'Server not found' });
    }
  });

  /**
   * POST /api/mcp/servers
   * 添加 MCP server
   */
  router.post('/servers', (req, res) => {
    const { name, type, description, command, args, env, url, headers } = req.body;

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    if (type === 'stdio') {
      if (!command) {
        res.status(400).json({ error: 'command is required for stdio type' });
        return;
      }
      mcpRegistry.upsert(name, {
        type: 'stdio',
        description: description || '',
        command,
        args: args || [],
        env: env || {},
      });
    } else if (type === 'http') {
      if (!url) {
        res.status(400).json({ error: 'url is required for http type' });
        return;
      }
      mcpRegistry.upsert(name, {
        type: 'http',
        description: description || '',
        url,
        headers: headers || {},
      });
    } else {
      res.status(400).json({ error: 'type must be stdio or http' });
      return;
    }

    res.json({ success: true, name });
  });

  /**
   * PUT /api/mcp/servers/:name
   * 更新 MCP server
   */
  router.put('/servers/:name', (req, res) => {
    const { name } = req.params;
    const existing = mcpRegistry.get(name);

    if (!existing) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const { type, description, command, args, env, url, headers } = req.body;

    if (type === 'stdio' || (!type && existing.type === 'stdio')) {
      mcpRegistry.upsert(name, {
        type: 'stdio',
        description: description || existing.description,
        command: command || (existing as any).command,
        args: args || (existing as any).args,
        env: env || (existing as any).env || {},
      });
    } else if (type === 'http' || (!type && existing.type === 'http')) {
      mcpRegistry.upsert(name, {
        type: 'http',
        description: description || existing.description,
        url: url || (existing as any).url,
        headers: headers || (existing as any).headers || {},
      });
    } else {
      res.status(400).json({ error: 'Invalid type' });
      return;
    }

    res.json({ success: true, name });
  });

  /**
   * DELETE /api/mcp/servers/:name
   * 删除 MCP server
   */
  router.delete('/servers/:name', (req, res) => {
    const success = mcpRegistry.remove(req.params.name);

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Server not found' });
    }
  });

  return router;
}
