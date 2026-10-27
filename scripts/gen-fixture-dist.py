"""Generates the deterministic prebuilt dist/ output for test fixtures (sizes are what matter)."""
import json, os, sys

root = os.path.join(os.path.dirname(__file__), '..', 'test', 'fixtures')

def filler(name, size, ext):
    """Valid JS/CSS of exactly `size` bytes: whole lines, then a padding comment."""
    line = (f'/*{name}*/function f{{i}}(a,b){{return a*{{i}}+b%{{i}}}}\n' if ext == 'js'
            else f'.c{{i}}{{margin:{{i}}px;padding:{{i}}px}}\n')
    out, total, i = [], 0, 1
    while True:
        nxt = line.replace('{i}', str(i))
        if total + len(nxt) > size - 16:
            break
        out.append(nxt); total += len(nxt); i += 1
    pad = size - total
    out.append('/*' + 'x' * (pad - 5) + '*/\n')
    return ''.join(out)

HEALTHY_BODY = '''<header><nav aria-label="Main"><a href="/">Home</a> <a href="/about">About</a></nav></header>
<main><h1>Todos</h1><p>Everything you need to do, in one place.</p>
<form><label for="new-todo">New todo</label> <input id="new-todo" name="todo"> <button type="submit">Add</button></form>
<ul><li>Write the report</li><li>Ship it</li></ul></main>
<app-root></app-root>'''

# Deliberate WCAG violations: missing lang/title/alt/labels/names, low contrast.
UNHEALTHY_BODY = '''<div class="header"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><a href="/profile"><i class="icon"></i></a></div>
<div class="content"><p style="color:#bbb;background:#fff">Low contrast welcome text</p>
<input type="text" placeholder="Search"> <button><i class="icon-search"></i></button>
<button>Save</button></div>
<app-root></app-root>'''

HEAD = {
    'healthy': '<html lang="en"><head><meta charset="utf-8"><title>Healthy App</title>'
               '<meta name="viewport" content="width=device-width, initial-scale=1">'
               '<meta name="description" content="A small, healthy Angular fixture app.">'
               '<link rel="icon" href="data:,">',
    'unhealthy': '<html><head><meta charset="utf-8"><link rel="icon" href="data:,">',
}

def write(app, files, index_refs, stats=None):
    browser = os.path.join(root, app['fixture'], 'dist', app['name'], 'browser')
    os.makedirs(browser, exist_ok=True)
    for fname, size in files.items():
        with open(os.path.join(browser, fname), 'w') as fh:
            fh.write(filler(fname, size, fname.rsplit('.', 1)[1]))
    scripts = ''.join(f'<script src="{f}" type="module"></script>' for f in index_refs if f.endswith('.js'))
    links = ''.join(f'<link rel="stylesheet" href="{f}">' for f in index_refs if f.endswith('.css'))
    with open(os.path.join(browser, 'index.html'), 'w') as fh:
        body = HEALTHY_BODY if app['fixture'] == 'healthy' else UNHEALTHY_BODY
        fh.write(f"<!doctype html>{HEAD[app['fixture']]}{links}</head><body>{body}{scripts}</body></html>\n")
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
