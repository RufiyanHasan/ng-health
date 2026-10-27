"""Generates the deterministic prebuilt dist/ output for test fixtures (sizes are what matter)."""
import json, os, sys

root = os.path.join(os.path.dirname(__file__), '..', 'test', 'fixtures')

def filler(name, size, ext):
    line = (f'/*{name}*/function f{{i}}(a,b){{return a*{{i}}+b%{{i}}}}\n' if ext == 'js'
            else f'.c{{i}}{{margin:{{i}}px;padding:{{i}}px}}\n')
    out, i = [], 1
    while sum(map(len, out)) < size:
        out.append(line.replace('{i}', str(i))); i += 1
    return ''.join(out)[:size]

def write(app, files, index_refs, stats=None):
    browser = os.path.join(root, app['fixture'], 'dist', app['name'], 'browser')
    os.makedirs(browser, exist_ok=True)
    for fname, size in files.items():
        with open(os.path.join(browser, fname), 'w') as fh:
            fh.write(filler(fname, size, fname.rsplit('.', 1)[1]))
    scripts = ''.join(f'<script src="{f}" type="module"></script>' for f in index_refs if f.endswith('.js'))
    links = ''.join(f'<link rel="stylesheet" href="{f}">' for f in index_refs if f.endswith('.css'))
    with open(os.path.join(browser, 'index.html'), 'w') as fh:
        fh.write(f'<!doctype html><html><head>{links}</head><body><app-root></app-root>{scripts}</body></html>\n')
    if stats:
        with open(os.path.join(root, app['fixture'], 'dist', app['name'], 'stats.json'), 'w') as fh:
            json.dump(stats, fh, indent=2)

KB = 1024
healthy = {
    'main-HLTH1234.js': 60 * KB, 'polyfills-POLY5678.js': 12 * KB, 'styles-STYL9012.css': 3 * KB,
    'chunk-SHRD7890.js': 8 * KB, 'chunk-LAZY3456.js': 20 * KB,
}
stats = {
    'inputs': {},
    'outputs': {
        'main-HLTH1234.js': {
            'bytes': healthy['main-HLTH1234.js'], 'entryPoint': 'src/main.ts',
            'imports': [{'path': 'chunk-SHRD7890.js', 'kind': 'import-statement'},
                        {'path': 'chunk-LAZY3456.js', 'kind': 'dynamic-import'}],
            'inputs': {
                'node_modules/@angular/core/fesm2022/core.mjs': {'bytesInOutput': 38000},
                'node_modules/@angular/platform-browser/fesm2022/platform-browser.mjs': {'bytesInOutput': 9000},
                'src/app/app.component.ts': {'bytesInOutput': 1800},
                'src/main.ts': {'bytesInOutput': 120},
            },
        },
        'chunk-SHRD7890.js': {
            'bytes': healthy['chunk-SHRD7890.js'], 'imports': [],
            'inputs': {'node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs/dist/esm/internal/Observable.js': {'bytesInOutput': 6500}},
        },
        'chunk-LAZY3456.js': {
            'bytes': healthy['chunk-LAZY3456.js'], 'imports': [{'path': 'chunk-SHRD7890.js', 'kind': 'import-statement'}],
            'inputs': {'src/app/todo-list/todo-list.component.ts': {'bytesInOutput': 2400},
                       'node_modules/@angular/common/fesm2022/common.mjs': {'bytesInOutput': 15000}},
        },
        'polyfills-POLY5678.js': {'bytes': healthy['polyfills-POLY5678.js'], 'entryPoint': 'angular:polyfills', 'imports': [],
                                  'inputs': {'angular:polyfills': {'bytesInOutput': 11000}}},
        'styles-STYL9012.css': {'bytes': healthy['styles-STYL9012.css'], 'entryPoint': 'angular:styles/global:styles', 'imports': [], 'inputs': {}},
    },
}
write({'fixture': 'healthy', 'name': 'healthy-app'}, healthy,
      ['styles-STYL9012.css', 'polyfills-POLY5678.js', 'main-HLTH1234.js'], stats)

unhealthy = {
    'main-UNHL1111.js': 150 * KB, 'polyfills-UNHL2222.js': 35 * KB, 'styles-UNHL3333.css': 5 * KB,
    'chunk-UNHL4444.js': 300 * KB,
}
write({'fixture': 'unhealthy', 'name': 'unhealthy-app'}, unhealthy,
      ['styles-UNHL3333.css', 'polyfills-UNHL2222.js', 'main-UNHL1111.js'])
