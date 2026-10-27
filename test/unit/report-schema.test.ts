import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { audit } from '../../src/core/audit.js';
import { silentLogger } from '../../src/core/logger.js';
import { ReportSchema, reportJsonSchema } from '../../src/core/report-schema.js';
import { renderJson } from '../../src/reporters/json.js';
import { fixture } from '../helpers/fixtures.js';
import { sampleReport } from '../helpers/report.js';

const schemaFile = new URL('../../schema/report.v1.json', import.meta.url);

describe('report schema v1', () => {
  it('published schema/report.v1.json is up to date (run `npm run build`)', async () => {
    expect(JSON.parse(await readFile(schemaFile, 'utf8'))).toEqual({
      title: 'ng-health report (v1)',
      ...reportJsonSchema(),
    });
  });

  it('real and sample reports validate against the published JSON Schema', async () => {
    const ajv = new Ajv2020.default({ allErrors: true, strict: false });
    addFormats.default(ajv);
    const validate = ajv.compile(JSON.parse(await readFile(schemaFile, 'utf8')));
    const { report } = await audit(
      fixture('unhealthy'),
      { skip: ['performance', 'accessibility'] },
      silentLogger,
    );
    for (const r of [report, sampleReport()]) {
      const json = JSON.parse(renderJson(r));
      expect(validate(json), JSON.stringify(validate.errors)).toBe(true);
      expect(ReportSchema.safeParse(json).success).toBe(true);
    }
    expect(validate({ ...JSON.parse(renderJson(report)), schemaVersion: '2.0' })).toBe(false);
  });
});
