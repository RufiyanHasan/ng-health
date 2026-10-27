import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadConfig, parseConfig } from '../../src/core/config/loader.js';
import { configJsonSchema, DEFAULT_IGNORE } from '../../src/core/config/schema.js';
import { DEFAULT_CONFIG } from '../../src/cli/commands/init.js';
import { makeTempProject } from '../helpers/tmp.js';

describe('parseConfig', () => {
  it('applies defaults to an empty config', () => {
    const c = parseConfig({});
    expect(c.skip).toEqual([]);
    expect(c.ignore).toEqual(DEFAULT_IGNORE);
    expect(c.output).toEqual({ dir: 'fe-health-report', formats: ['console', 'html'] });
    expect(c.thresholds).toEqual({ minOverallScore: 70, maxCriticalVulnerabilities: 0 });
    expect(c.offline).toBe(false);
  });

  it('accepts a full config', () => {
    const c = parseConfig({
      checks: { 'angular/onpush': { enabled: true, weight: 2, options: { x: 1 } }, bundle: false },
      only: ['angular'],
      weights: { angular: 50 },
      severityPenalties: { critical: 50 },
      thresholds: {
        minOverallScore: 80,
        minCategoryScores: { angular: 60 },
        failOnSeverity: 'high',
      },
      output: { formats: ['json'] },
    });
    expect(c.checks['bundle']).toBe(false);
    expect(c.output).toEqual({ dir: 'fe-health-report', formats: ['json'] });
    expect(c.severityPenalties).toEqual({ critical: 50 });
  });

  it('reports every invalid field with its path', () => {
    expect(() =>
      parseConfig({ thresholds: { minOverallScore: 150 }, output: { formats: ['pdf'] }, typo: 1 }),
    ).toThrowError(
      /thresholds\.minOverallScore[\s\S]*output\.formats\.0|output\.formats\.0[\s\S]*thresholds/,
    );
    expect(() => parseConfig({ typo: 1 })).toThrowError(/Unrecognized key.*typo/);
  });

  it('the init template is a valid config', () => {
    expect(() => parseConfig(DEFAULT_CONFIG)).not.toThrow();
  });
});

describe('loadConfig', () => {
  it('uses defaults when no config file exists', async () => {
    const dir = await makeTempProject({});
    const { config, file } = await loadConfig(dir);
    expect(file).toBeUndefined();
    expect(config.skip).toEqual([]);
  });

  it('loads fe-health.config.json from the project root (JSONC allowed)', async () => {
    const dir = await makeTempProject({
      'fe-health.config.json': '{ // comment\n "skip": ["bundle"], }',
    });
    const { config, file } = await loadConfig(dir);
    expect(file).toBe(`${dir}/fe-health.config.json`);
    expect(config.skip).toEqual(['bundle']);
  });

  it('errors when an explicit config path is missing', async () => {
    const dir = await makeTempProject({});
    await expect(loadConfig(dir, `${dir}/nope.json`)).rejects.toThrow(/Config file not found/);
  });
});

describe('published JSON schema', () => {
  it('is up to date with the zod schema (run `npm run build` to regenerate)', async () => {
    const committed = JSON.parse(await readFile('schema/config.schema.json', 'utf8'));
    expect(committed).toEqual({ title: 'fe-health configuration', ...configJsonSchema() });
  });
});
