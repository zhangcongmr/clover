import { Router, json } from 'express';
import { SkillRegistry } from '../skills/registry.js';

export function createSkillRoutes(skillRegistry: SkillRegistry): Router {
  const router = Router();
  router.use(json({ limit: '2mb' }));

  /**
   * GET /api/skills
   * 获取所有 skills（聚合 store、各 skill 目录与 HTTP catalog 缓存）
   */
  router.get('/', (req, res) => {
    const skills = skillRegistry.list();
    const discovery = skillRegistry.getDiscovery();
    res.json({
      skills,
      sources: discovery?.sources ?? [],
      configFiles: discovery?.configFiles ?? [],
      catalogs: discovery?.catalogs ?? [],
    });
  });

  /**
   * GET /api/skills/:name
   * 获取单个 skill
   */
  router.get('/:name', (req, res) => {
    const skill = skillRegistry.get(req.params.name);
    if (skill) {
      res.json({ skill, writable: skillRegistry.canModify(req.params.name) });
    } else {
      res.status(404).json({ error: 'Skill not found' });
    }
  });

  /**
   * POST /api/skills
   * 添加 skill（已存在则覆盖）
   */
  router.post('/', (req, res) => {
    const { name, description, content } = req.body;

    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    skillRegistry.upsert(String(name), {
      description: description || '',
      content,
    });

    res.json({ success: true, name: String(name).trim() });
  });

  /**
   * PUT /api/skills/:name
   * 更新 skill
   */
  router.put('/:name', (req, res) => {
    const { name } = req.params;
    const existing = skillRegistry.get(name);

    if (!existing) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }

    const { description, content } = req.body;

    if (content !== undefined && (typeof content !== 'string' || !content.trim())) {
      res.status(400).json({ error: 'content must be a non-empty string' });
      return;
    }

    // 扫描自磁盘的 skill 不在 skills.json 中，改动无法持久化，直接拒绝
    if (!skillRegistry.canModify(name)) {
      res.status(409).json({
        error: 'Skill is read-only',
        detail: 'This skill was discovered on disk. Edit its SKILL.md file instead.',
      });
      return;
    }

    skillRegistry.upsert(name, {
      description: description !== undefined ? description : existing.description,
      content: content !== undefined ? content : existing.content,
    });

    res.json({ success: true, name });
  });

  /**
   * POST /api/skills/reload
   * 刷新 HTTP catalog 缓存（联网，按 version 增量下载）并重新扫描所有 skill 来源
   */
  router.post('/reload', async (req, res) => {
    try {
      const discovery = await skillRegistry.refreshRemote();
      res.json({
        success: true,
        count: skillRegistry.list().length,
        sources: discovery?.sources ?? [],
        configFiles: discovery?.configFiles ?? [],
        catalogs: discovery?.catalogs ?? [],
        errors: discovery?.errors ?? [],
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * POST /api/skills/:name/duplicate
   * 复制 skill，副本插入到原 skill 之后
   */
  router.post('/:name/duplicate', (req, res) => {
    const copy = skillRegistry.duplicate(req.params.name);
    if (copy) {
      res.json({ success: true, skill: copy });
    } else {
      res.status(404).json({ error: 'Skill not found' });
    }
  });

  /**
   * DELETE /api/skills/:name
   * 删除 skill（仅限 skills.json 中的条目）
   */
  router.delete('/:name', (req, res) => {
    const { name } = req.params;

    if (!skillRegistry.get(name)) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }

    if (!skillRegistry.canModify(name)) {
      res.status(409).json({
        error: 'Skill is read-only',
        detail: 'This skill was discovered on disk. Delete its SKILL.md file instead.',
      });
      return;
    }

    res.json({ success: skillRegistry.remove(name) });
  });

  return router;
}
