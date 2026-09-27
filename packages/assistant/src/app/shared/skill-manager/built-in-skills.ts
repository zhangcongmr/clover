import { THEME_GENERATOR_CONTENT } from './built-in/theme-generator.content';
import { RESTAURANTS_FINDER_CONTENT } from './built-in/restaurants-finder.content';
import type { SkillInfo } from '../skills/skill.service';

/**
 * Built-in skills bundled with the app.
 *
 * These are seeded to the server (`POST /api/skills`) by `SkillService.refresh()`
 * whenever they are missing. In the skill manager they are read-only:
 * "View" instead of "Edit", no "Delete" button.
 */
export const BUILT_IN_SKILLS: readonly SkillInfo[] = [
  {
    name: 'Theme-generator',
    description: 'Generate an A2UI theme preview from a style description',
    content: THEME_GENERATOR_CONTENT,
  },
  {
    name: 'Restaurants-finder',
    description: 'Find restaurants and book tables (A2UI)',
    content: RESTAURANTS_FINDER_CONTENT,
  },
];

export const BUILT_IN_SKILL_NAMES: ReadonlySet<string> = new Set(
  BUILT_IN_SKILLS.map(skill => skill.name),
);
