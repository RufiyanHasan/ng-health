import type { Severity } from '../../core/config/schema.js';
import { defineCheck, skipCheck, type Finding } from '../../core/types.js';
import { parseJsonOutput } from '../util.js';
import { pmCommand } from './package-json.js';

type AuditSeverity = 'info' | 'low' | 'moderate' | 'high' | 'critical';

const SEVERITY: Record<AuditSeverity, Severity | undefined> = {
  critical: 'critical',
  high: 'high',
  moderate: 'medium',
  low: 'low',
  info: undefined,
};

export interface Vulnerability {
  name: string;
  severity: Severity;
  title: string;
  url: string | undefined;
  fix: string;
  direct: boolean;
}

interface NpmAuditV2 {
  vulnerabilities?: Record<
    string,
    {
      name: string;
      severity: AuditSeverity;
      isDirect?: boolean;
      range?: string;
      via?: (string | { title?: string; url?: string })[];
      fixAvailable?: boolean | { name: string; version: string; isSemVerMajor?: boolean };
    }
  >;
  /** npm 6 / pnpm format */
  advisories?: Record<
    string,
    {
      module_name: string;
      severity: AuditSeverity;
      title: string;
      url?: string;
      patched_versions?: string;
    }
  >;
  error?: { code?: string; summary?: string };
}

export function parseAudit(json: NpmAuditV2, pm: string): Vulnerability[] {
  const out: Vulnerability[] = [];
  for (const v of Object.values(json.vulnerabilities ?? {})) {
    const severity = SEVERITY[v.severity];
    if (!severity) continue;
    const advisory = v.via?.find(
      (x): x is { title?: string; url?: string } => typeof x === 'object',
    );
    const via = v.via?.filter((x): x is string => typeof x === 'string') ?? [];
    const fix = v.fixAvailable;
    out.push({
      name: v.name,
      severity,
      title: advisory?.title ?? (via.length ? `via ${via.join(', ')}` : 'vulnerable version range'),
      url: advisory?.url,
      direct: Boolean(v.isDirect),
      fix:
        fix === true
          ? `Run "${pm} audit fix".`
          : fix
            ? `Upgrade ${fix.name} to ${fix.version}${fix.isSemVerMajor ? ' (breaking change)' : ''}.`
            : `No fix available yet: check whether ${v.name} is still needed, or replace it.`,
    });
  }
  for (const a of Object.values(json.advisories ?? {})) {
    const severity = SEVERITY[a.severity];
    if (!severity) continue;
    out.push({
      name: a.module_name,
      severity,
      title: a.title,
      url: a.url,
      direct: false,
      fix:
        a.patched_versions && a.patched_versions !== '<0.0.0'
          ? `Upgrade ${a.module_name} to ${a.patched_versions}.`
          : `No patched version: replace ${a.module_name} or remove the dependency on it.`,
    });
  }
  const order: Severity[] = ['critical', 'high', 'medium', 'low'];
  return out.sort(
    (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || a.name.localeCompare(b.name),
  );
}

export default defineCheck({
  id: 'dependencies/vulnerabilities',
  name: 'Known vulnerabilities',
  category: 'dependencies',
  description: 'npm/pnpm audit results grouped by severity.',
  timeoutMs: 180_000,
  async run(ctx) {
    if (ctx.offline) skipCheck('Offline mode: registry lookup disabled');
    const pm = pmCommand(ctx);
    const r = await ctx.exec(pm, ['audit', '--json']);
    const json = parseJsonOutput<NpmAuditV2>(r.stdout);
    if (json?.error) {
      if (json.error.code === 'ENOLOCK')
        skipCheck('No lockfile found: npm audit needs package-lock.json');
      throw new Error(`${pm} audit failed: ${json.error.summary ?? json.error.code}`);
    }
    if (!json)
      throw new Error(`${pm} audit failed: ${(r.stderr || 'no output').trim().split('\n')[0]}`);

    const vulns = parseAudit(json, pm);
    const findings: Finding[] = vulns.map((v) => ({
      severity: v.severity,
      ruleId: 'vulnerable-package',
      message: `${v.name}${v.direct ? '' : ' (transitive)'}: ${v.title}`,
      fixHint: v.fix,
      ...(v.url ? { docsUrl: v.url } : {}),
    }));
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const v of vulns) counts[v.severity]++;
    return { findings, meta: { counts } };
  },
});
