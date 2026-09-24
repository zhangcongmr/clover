import { Router, json } from 'express';
import { SkillRegistry } from '../skills/registry.js';

export function createSkillRoutes(skillRegistry: SkillRegistry): Router {
  const router = Router();
  router.use(json({ limit: '2mb' }));

  /**
   * GET /api/skills
   * 获取所有 skills
   */
  router.get('/', (req, res) => {
    const skills = skillRegistry.list();
    res.json({ skills });
  });

  /**
   * GET /api/skills/:name
   * 获取单个 skill
   */
  router.get('/:name', (req, res) => {
    const skill = skillRegistry.get(req.params.name);
    if (skill) {
      res.json({ skill });
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

    skillRegistry.upsert(name, {
      description: description !== undefined ? description : existing.description,
      content: content !== undefined ? content : existing.content,
    });

    res.json({ success: true, name });
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
   * 删除 skill
   */
  router.delete('/:name', (req, res) => {
    const success = skillRegistry.remove(req.params.name);

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Skill not found' });
    }
  });

  return router;
}
