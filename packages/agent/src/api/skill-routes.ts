import { Router, json } from 'express';
import { SkillRegistry } from '../skills/registry.js';

export function createSkillRoutes(skillRegistry: SkillRegistry): Router {
  const router = Router();
  // 安装 catalog skill 时可能携带附属文件（references/ 等），放宽到 8mb
  router.use(json({ limit: '8mb' }));

  /**
   * GET /api/skills
   * 获取所有 skills（聚合 legacy store 与各用户级 skill 目录）
   */
  router.get('/', (req, res) => {
    const discovery = skillRegistry.getDiscovery();
    const skills = skillRegistry.list().map((skill) => ({
      ...skill,
      // 目录 store skill 的附属文件数量（供前端决定是否按需拉取）
      fileCount: skill.source === '~/.clover/skills' ? skillRegistry.fileCount(skill.name) : 0,
    }));
    res.json({
      skills,
      sources: discovery?.sources ?? [],
      configFiles: discovery?.configFiles ?? [],
      catalogs: discovery?.catalogs ?? [],
    });
  });

  /**
   * GET /api/skills/:name
   * 获取单个 skill + 附属文件映射（相对路径 → 内容）
   */
  router.get('/:name', (req, res) => {
    const skill = skillRegistry.get(req.params.name);
    if (skill) {
      res.json({
        skill,
        writable: skillRegistry.canModify(req.params.name),
        files: skillRegistry.listSkillFiles(req.params.name),
      });
    } else {
      res.status(404).json({ error: 'Skill not found' });
    }
  });

  /**
   * POST /api/skills
   * 添加 skill（已存在则覆盖）；可携带附属文件（如从 HTTP catalog 安装）
   */
  router.post('/', (req, res) => {
    const { name, description, content, files } = req.body;

    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'content is required' });
      return;
    }
    if (files !== undefined && (typeof files !== 'object' || files === null || Array.isArray(files))) {
      res.status(400).json({ error: 'files must be an object of relative path → content' });
      return;
    }

    try {
      skillRegistry.upsert(String(name), {
        description: description || '',
        content,
      }, files as Record<string, string> | undefined);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    res.json({ success: true, name: String(name).trim() });
  });

  /**
   * PUT /api/skills/:name
   * 更新 skill（正文与描述；附属文件保持不变）
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

    // 扫描自其它来源（~/.claude 等）的 skill 只读
    if (!skillRegistry.canModify(name)) {
      res.status(409).json({
        error: 'Skill is read-only',
        detail: 'This skill was discovered on disk. Edit its SKILL.md file instead.',
      });
      return;
    }

    // 保留附属文件：写回当前文件映射（upsert 会重新落盘）
    try {
      skillRegistry.upsert(name, {
        description: description !== undefined ? description : existing.description,
        content: content !== undefined ? content : existing.content,
      }, skillRegistry.listSkillFiles(name));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    res.json({ success: true, name });
  });

  /**
   * POST /api/skills/reload
   * 重新扫描所有 skill 来源（HTTP catalog 由前端直连，与此无关）
   */
  router.post('/reload', (req, res) => {
    const discovery = skillRegistry.reload();
    res.json({
      success: true,
      count: skillRegistry.list().length,
      sources: discovery?.sources ?? [],
      configFiles: discovery?.configFiles ?? [],
      catalogs: discovery?.catalogs ?? [],
      errors: discovery?.errors ?? [],
    });
  });

  /**
   * POST /api/skills/:name/duplicate
   * 复制 skill（含附属文件），副本插入到原 skill 之后
   */
  router.post('/:name/duplicate', (req, res) => {
    try {
      const copy = skillRegistry.duplicate(req.params.name);
      if (copy) {
        res.json({ success: true, skill: copy });
      } else {
        res.status(404).json({ error: 'Skill not found' });
      }
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * DELETE /api/skills/:name
   * 删除 skill（目录 store 删目录；legacy 条目一并从 skills.json 移除）
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
