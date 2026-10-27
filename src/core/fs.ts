import { readFile, stat } from 'node:fs/promises';
import { NgHealthError, errorMessage } from './errors.js';

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Removes // and /* *\/ comments and trailing commas from JSON text, leaving string
 * contents untouched. angular.json and tsconfig.json are commonly written as JSONC.
 */
export function stripJsonc(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else {
      out += ch;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

export function parseJsonc<T = unknown>(text: string): T {
  return JSON.parse(stripJsonc(text.replace(/^\uFEFF/, ''))) as T;
}

/** Reads a JSON/JSONC file; returns undefined if it does not exist, throws NgHealthError if invalid. */
export async function readJsonFile<T = unknown>(file: string): Promise<T | undefined> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new NgHealthError(`Could not read ${file}: ${errorMessage(err)}`, { cause: err });
  }
  try {
    return parseJsonc<T>(text);
  } catch (err) {
    throw new NgHealthError(`${file} is not valid JSON: ${errorMessage(err)}`, { cause: err });
  }
}
