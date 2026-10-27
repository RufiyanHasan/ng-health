import path from 'node:path';

/** esbuild metafile, as written by Angular's application builder with --stats-json. */
export interface EsbuildMetafile {
  inputs?: Record<string, unknown>;
  outputs: Record<
    string,
    {
      bytes: number;
      entryPoint?: string;
      imports?: { path: string; kind: string }[];
      inputs?: Record<string, { bytesInOutput: number }>;
    }
  >;
}

/** Webpack stats, as written by the legacy browser builder with --stats-json. */
export interface WebpackStats {
  chunks?: { initial: boolean; files: string[] }[];
  modules?: { name: string; size: number }[];
}

export interface ModuleSize {
  path: string;
  bytes: number;
}

const base = (p: string) => path.posix.basename(p);

/** Initial files: entry points plus everything they import statically, transitively. */
export function initialFromMetafile(meta: EsbuildMetafile): Set<string> {
  const outputs = meta.outputs;
  const byBase = new Map(Object.keys(outputs).map((k) => [base(k), k]));
  const initial = new Set<string>();
  const queue = Object.entries(outputs)
    .filter(([file, o]) => o.entryPoint && (file.endsWith('.js') || file.endsWith('.css')))
    .map(([file]) => file);
  while (queue.length) {
    const file = queue.pop() as string;
    if (initial.has(base(file))) continue;
    initial.add(base(file));
    for (const imp of outputs[file]?.imports ?? []) {
      if (imp.kind !== 'import-statement') continue;
      const target = byBase.get(base(imp.path));
      if (target) queue.push(target);
    }
  }
  return initial;
}

export function initialFromWebpack(stats: WebpackStats): Set<string> {
  return new Set((stats.chunks ?? []).filter((c) => c.initial).flatMap((c) => c.files.map(base)));
}

/** Fallback without stats: scripts, modulepreloads and stylesheets referenced by index.html. */
export function initialFromIndexHtml(html: string): Set<string> {
  const files = new Set<string>();
  const re = /<(?:script[^>]*\ssrc|link[^>]*\shref)=["']([^"']+\.(?:js|css))["']/gi;
  for (const m of html.matchAll(re)) {
    const src = m[1];
    if (src && !/^(https?:)?\/\//.test(src)) files.add(base(src));
  }
  return files;
}

/** Normalises a module path: node_modules/.pnpm/x@1/node_modules/@scope/pkg/f.js → node_modules/@scope/pkg/f.js */
export function normalizeModulePath(p: string): string {
  const cleaned = p.replace(/^.*?(?:\.pnpm\/[^/]+\/)?(node_modules\/)/, '$1').replace(/^\.\//, '');
  const idx = cleaned.lastIndexOf('node_modules/');
  return idx > 0 ? cleaned.slice(idx) : cleaned;
}

export function topModules(stats: EsbuildMetafile | WebpackStats, limit = 10): ModuleSize[] {
  const sizes = new Map<string, number>();
  if ('outputs' in stats) {
    for (const [file, out] of Object.entries(stats.outputs)) {
      if (!file.endsWith('.js')) continue;
      for (const [input, { bytesInOutput }] of Object.entries(out.inputs ?? {})) {
        const key = normalizeModulePath(input);
        sizes.set(key, (sizes.get(key) ?? 0) + bytesInOutput);
      }
    }
  } else {
    for (const m of stats.modules ?? []) {
      const key = normalizeModulePath(m.name);
      sizes.set(key, (sizes.get(key) ?? 0) + m.size);
    }
  }
  return [...sizes]
    .map(([p, bytes]) => ({ path: p, bytes }))
    .filter((m) => m.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path))
    .slice(0, limit);
}
