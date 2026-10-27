import { describe, expect, it } from 'vitest';
import { parseJsonc, readJsonFile } from '../../src/core/fs.js';
import { NgHealthError } from '../../src/core/errors.js';
import { makeTempProject } from '../helpers/tmp.js';

describe('parseJsonc', () => {
  it('strips line and block comments and trailing commas', () => {
    const text = `{
      // line comment
      "a": 1, /* block
      comment */
      "b": [1, 2,],
    }`;
    expect(parseJsonc(text)).toEqual({ a: 1, b: [1, 2] });
  });

  it('keeps comment-like content inside strings', () => {
    expect(parseJsonc('{"url": "http://x//y", "g": "/* no */", "q": "a\\"//b"}')).toEqual({
      url: 'http://x//y',
      g: '/* no */',
      q: 'a"//b',
    });
  });

  it('handles a BOM', () => {
    expect(parseJsonc('﻿{"a":1}')).toEqual({ a: 1 });
  });
});

describe('readJsonFile', () => {
  it('returns undefined for missing files', async () => {
    const dir = await makeTempProject({});
    expect(await readJsonFile(`${dir}/missing.json`)).toBeUndefined();
  });

  it('throws a NgHealthError naming the file for invalid JSON', async () => {
    const dir = await makeTempProject({ 'bad.json': '{ nope' });
    await expect(readJsonFile(`${dir}/bad.json`)).rejects.toThrow(NgHealthError);
    await expect(readJsonFile(`${dir}/bad.json`)).rejects.toThrow(/bad\.json is not valid JSON/);
  });
});
