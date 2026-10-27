import type { CheckSettings, Config } from './config/schema.js';
import { NgHealthError } from './errors.js';
import type { Check } from './types.js';

export interface SelectedCheck {
  check: Check;
  settings: CheckSettings;
}

export interface Selection {
  selected: SelectedCheck[];
  excluded: { check: Check; reason: string }[];
  /** --only/--skip tokens that matched no check id or category. */
  unknownTokens: string[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;

export function validateRegistry(checks: Check[]): void {
  const seen = new Set<string>();
  for (const check of checks) {
    if (!ID_PATTERN.test(check.id)) {
      throw new NgHealthError(`Invalid check id "${check.id}"`, {
        hint: 'Check ids are lowercase kebab-case, optionally namespaced: "category/name".',
      });
    }
    if (seen.has(check.id)) throw new NgHealthError(`Duplicate check id "${check.id}"`);
    seen.add(check.id);
  }
}

const matches = (check: Check, token: string) => check.id === token || check.category === token;

function settingsFor(check: Check, config: Config): CheckSettings | false {
  const normalize = (v: CheckSettings | boolean | undefined): CheckSettings | false | undefined =>
    v === undefined ? undefined : v === false ? false : v === true ? { enabled: true } : v;
  const byCategory = normalize(config.checks[check.category]);
  const byId = normalize(config.checks[check.id]);
  if (byId === false || (byId === undefined && byCategory === false)) return false;
  const base = byCategory || {};
  const own = byId || {};
  return {
    ...base,
    ...own,
    options: { ...base.options, ...own.options },
  };
}

export function selectChecks(
  checks: Check[],
  config: Config,
  filters: { only: string[] | undefined; skip: string[] },
): Selection {
  const tokens = [...(filters.only ?? []), ...filters.skip];
  const unknownTokens = tokens.filter((t) => !checks.some((c) => matches(c, t)));
  const selection: Selection = { selected: [], excluded: [], unknownTokens };

  for (const check of checks) {
    const settings = settingsFor(check, config);
    const explicitlyOnly = filters.only?.some((t) => matches(check, t)) ?? false;
    let reason: string | undefined;
    if (filters.only && !explicitlyOnly) reason = 'not selected by --only';
    else if (filters.skip.some((t) => matches(check, t))) reason = 'excluded by --skip';
    else if (settings === false || settings.enabled === false) reason = 'disabled in config';
    else if (check.enabledByDefault === false && settings.enabled !== true && !explicitlyOnly)
      reason = 'opt-in check (enable it in config)';

    if (reason !== undefined || settings === false) {
      selection.excluded.push({ check, reason: reason ?? 'disabled in config' });
    } else {
      selection.selected.push({ check, settings });
    }
  }
  return selection;
}
