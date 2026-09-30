#!/usr/bin/env python3
# scripts/port_folia_tests.py
# 用法: python scripts/port_folia_tests.py <folia-major 根目录> <lumisynth 根目录>
"""
Copies folia's engine/lyrics unit tests into lumisynth's test/unit, rewriting imports with the
file map in docs/vendor-manifest.json (written by vendor_folia.py), so run that first.
"""
import os, re, sys, json

FOLIA = sys.argv[1]
OUT = sys.argv[2]

TESTS = [
    'test/unit/lyrics/graphemeTiming.test.ts',
    'test/unit/lyrics/parserCore.test.ts',
    'test/unit/lyrics/wordSegmentation.test.ts',
    'test/unit/visualizer/pixiTextureBudget.test.ts',
    'test/unit/utils/lucideIconResolver.test.ts',
]
for name in sorted(os.listdir(os.path.join(FOLIA, 'test/unit/visualizer'))):
    # *Settings.test.ts exercise folia's settings store, which is not vendored.
    if re.match(r'(sonnet|tempera)\w*\.test\.ts$', name) and not name.endswith('Settings.test.ts'):
        TESTS.append(f'test/unit/visualizer/{name}')

manifest = json.load(open(os.path.join(OUT, 'docs/vendor-manifest.json'), encoding='utf-8'))
MOVES = {f['from']: f['to'] for f in manifest['files']}
REDIRECTS = {
    'src/types.ts': '@/packs/_compat/foliaTypes',
    'src/utils/lyrics/types.ts': '@/core/lyrics/types',
}
IMPORT_RE = re.compile(r"""((?:import|export)\s[^;]*?from\s+|import\(\s*|vi\.mock\(\s*)(['"])([^'"]+)\2""", re.S)

def resolve(importer, spec):
    if spec.startswith('@/'):  # folia's own `@/*` -> `./src/*`
        cand = 'src/' + spec[2:]
    else:
        cand = os.path.normpath(os.path.join(os.path.dirname(importer), spec)).replace(os.sep, '/')
    for suf in ['', '.ts', '.tsx', '/index.ts']:
        if os.path.isfile(os.path.join(FOLIA, cand + suf)):
            return cand + suf
    return None

unresolved = []
for old in TESTS:
    text = open(os.path.join(FOLIA, old), encoding='utf-8').read()

    def repl(m):
        head, quote, spec = m.group(1), m.group(2), m.group(3)
        if spec == 'framer-motion':
            return f'{head}{quote}@/packs/_compat/motion{quote}'
        if not spec.startswith(('.', '@/')):
            return m.group(0)
        target = resolve(old, spec)
        if target in REDIRECTS:
            new_spec = REDIRECTS[target]
        elif target in MOVES:
            new_spec = '@/' + re.sub(r'\.tsx?$', '', MOVES[target])[len('src/'):]
        else:
            unresolved.append(f'{old}: {spec} -> {target}')
            return m.group(0)
        return f'{head}{quote}{new_spec}{quote}'

    out = IMPORT_RE.sub(repl, text)
    dst = os.path.join(OUT, old)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    open(dst, 'w', encoding='utf-8', newline='\n').write(out)

print(f'tests={len(TESTS)}')
for u in unresolved:
    print('UNRESOLVED', u)
