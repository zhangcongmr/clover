export { SkillRegistry, isValidSkillName, validateSkillFiles } from './registry.js';
export type { SkillRegistryOptions } from './registry.js';
export {
  collectSkillSources,
  directoryExists,
  discoverSkills,
  deriveSkillId,
  isNestedSkillFile,
  isRootSkillFile,
  parseFrontMatter,
  scanSkillSource,
} from './discovery.js';
export type {
  DiscoverOptions,
  DiscoveredSkill,
  ScanResult,
  SkillDiscovery,
  SkillSource,
  SourceReport,
} from './discovery.js';
export {
  CONFIG_FILE_NAMES,
  collectConfigSkillEntries,
  parseOpencodeConfig,
  stripJsonComments,
  stripTrailingCommas,
} from './config.js';
export type {
  ConfigScanOptions,
  ConfigScanResult,
  ConfigSkillEntry,
  ConfigSkillEntryKind,
} from './config.js';
export { resolveUserPath } from './paths.js';
export type { Skill, SkillsStore } from './types.js';
