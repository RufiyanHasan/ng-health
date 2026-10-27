export { audit, type AuditOutcome } from './core/audit.js';
export { loadConfig, parseConfig } from './core/config/loader.js';
export * from './core/config/schema.js';
export {
  detectProject,
  type ProjectInfo,
  type AngularProjectInfo,
  type PackageManager,
} from './core/detect/index.js';
export { ExitCode, FeHealthError } from './core/errors.js';
export type { Logger } from './core/logger.js';
export type { AuditOptions } from './core/options.js';
