export interface Skill {
  name: string;
  description: string;
  content: string;
}

export interface SkillsStore {
  skills: Record<string, Skill>;
}
