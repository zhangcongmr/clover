export type WelcomeTabId = 'working' | 'coding' | 'design';

export type WelcomeTabIcon = 'check-circle' | 'code' | 'smile';

export type WelcomeActionIcon = 'file-text' | 'dollar' | 'pie-chart' | 'home' | 'bug' | 'test' | 'refresh' | 'git' | 'layout' | 'grid' | 'palette' | 'type' | 'generate-theme';

export interface WelcomeAction {
  id: string;
  label: string;
  icon: WelcomeActionIcon;
  /** Static prompt template prefilled into the chat input. */
  prompt?: string;
  /**
   * Dynamic entry (mirrors Settings → "+ Generate themes using AI"): prefills
   * the Theme-generator skill with a randomly seeded style prompt instead of
   * a static `prompt`.
   */
  themeGenerator?: boolean;
}

export interface WelcomeTab {
  id: WelcomeTabId;
  label: string;
  icon: WelcomeTabIcon;
  actions: readonly WelcomeAction[];
}

/**
 * Welcome-screen presets: each category tab swaps the quick-action tags
 * below it; clicking a tag prefills the chat input (editable before
 * sending) with its `prompt`, except the `themeGenerator` entry which
 * loads the Theme-generator skill with a random seed (same behavior as
 * Settings → "+ Generate themes using AI"). Static prompts open with an
 * instruction to ask clarifying questions so the agent does not guess
 * missing details.
 */
export const WELCOME_TABS: readonly WelcomeTab[] = [
  {
    id: 'working',
    label: 'Working',
    icon: 'check-circle',
    actions: [
      {
        id: 'documentation',
        label: 'Documentation',
        icon: 'file-text',
        prompt:
          'Help me write technical documentation for my project. Ask me which part of the codebase or feature to document first, then draft it in Markdown.',
      },
      {
        id: 'financial-services',
        label: 'Financial Services',
        icon: 'dollar',
        prompt:
          'Help me build a financial-services feature (e.g. budgeting, invoicing, or payment reporting). Ask what data model and calculations you should start from.',
      },
      {
        id: 'visualization',
        label: 'Visualization',
        icon: 'pie-chart',
        prompt:
          'Help me visualize data in my project. Ask which dataset or metric to chart and in what form (bar, line, pie, table), then propose the implementation.',
      },
      {
        id: 'personal-workspace',
        label: 'Personal Workspace',
        icon: 'home',
        prompt:
          'Help me set up a personal workspace for notes and tasks in this project. Ask what structure and features you should start with.',
      },
    ],
  },
  {
    id: 'coding',
    label: 'Coding',
    icon: 'code',
    actions: [
      {
        id: 'fix-bug',
        label: 'Fix a Bug',
        icon: 'bug',
        prompt:
          'I have a bug to fix. Ask me for the error message or reproduction steps, then locate the cause in the codebase and propose a minimal fix.',
      },
      {
        id: 'write-tests',
        label: 'Write Tests',
        icon: 'test',
        prompt:
          'Help me add tests for existing code. Ask which module or function to cover first, then write tests following this project’s conventions.',
      },
      {
        id: 'refactor',
        label: 'Refactor Code',
        icon: 'refresh',
        prompt:
          'Help me refactor part of this codebase. Ask which file or area to focus on and what the goal is (readability, performance, structure), then suggest incremental steps.',
      },
      {
        id: 'review-changes',
        label: 'Review Changes',
        icon: 'git',
        prompt:
          'Review the current changes in this repository for correctness and style. Ask if a specific file or feature should be the focus, then report issues with file references.',
      },
    ],
  },
  {
    id: 'design',
    label: 'Design',
    icon: 'smile',
    actions: [
      {
        id: 'generate-theme',
        label: 'Generate Theme',
        icon: 'generate-theme',
        themeGenerator: true,
      },
      {
        id: 'landing-page',
        label: 'Landing Page',
        icon: 'layout',
        prompt:
          'Help me design and build a landing page for my product. Ask about the product, audience, and desired sections, then propose a layout before implementing.',
      },
      {
        id: 'dashboard',
        label: 'Dashboard',
        icon: 'grid',
        prompt:
          'Help me design a dashboard UI. Ask which metrics to show and for which users, then propose the widget layout and implement it.',
      },
      {
        id: 'color-system',
        label: 'Color System',
        icon: 'palette',
        prompt:
          'Help me create a color system for this interface. Ask about the mood and existing brand colors, then produce semantic color tokens with accessible contrasts.',
      },
      {
        id: 'typography',
        label: 'Typography',
        icon: 'type',
        prompt:
          'Help me define a typography scale for this project. Ask about the platforms and content density, then propose font sizes, weights, and line heights.',
      },
    ],
  },
];
