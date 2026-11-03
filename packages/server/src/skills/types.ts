export interface Skill {
  name: string;
  description: string;
  content: string;
  /** 展示名：frontmatter `name` 优先，未设置时等于 ID（即 `name`）。 */
  displayName?: string;
  /** 来源标签：`store`、`~/.claude/skills`、catalog URL 等。 */
  source?: string;
  /** skill 入口文件的绝对路径；来自 `skills.json` 的条目指向该 JSON 文件。 */
  path?: string;
  /** frontmatter 是否允许模型自动发现；`opencode/autoinvoke: false` 时为 false。 */
  autoinvoke?: boolean;
}

export interface SkillsStore {
  skills: Record<string, Skill>;
}
