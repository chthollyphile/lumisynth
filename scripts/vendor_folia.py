#!/usr/bin/env python3
# scripts/vendor_folia.py
# 用法: python scripts/vendor_folia.py <folia-major 根目录> <lumisynth 根目录> [folia commit]
"""
One-shot vendoring of folia's sonnet/tempera engines into lumisynth (phase A: as-is).

Copies files to their new home and rewrites every relative import by *resolving* it against
folia's tree first, so `../types` inside tempera/compositions (tempera's own types) and
`../../../types` (folia's global types.ts) are told apart correctly.
"""
import os, re, sys, json, shutil, hashlib

FOLIA = sys.argv[1]          # folia repo root
OUT = sys.argv[2]            # lumisynth repo root
UPSTREAM_COMMIT = sys.argv[3] if len(sys.argv) > 3 else 'unknown'

UI_EXCLUDE = re.compile(
    r'(Visualizer(Sonnet|Tempera)\.tsx|/entry\.tsx|/tuning\.ts|Settings(Panel|Controls)\.tsx'
    r'|TemperaImage\w*\.tsx|useTemperaLayerImageThumbnails\.ts|temperaDialogTokens\.ts|README\.md)$'
)

# folia path (relative to repo root, no extension) -> lumisynth path (relative, with extension)
MOVES = {}

def add_tree(src_dir, dst_dir):
    for root, _, files in os.walk(os.path.join(FOLIA, src_dir)):
        for name in files:
            rel = os.path.relpath(os.path.join(root, name), FOLIA).replace(os.sep, '/')
            if not rel.endswith(('.ts', '.tsx')) or UI_EXCLUDE.search(rel):
                continue
            MOVES[rel] = dst_dir + rel[len(src_dir):]

add_tree('src/components/visualizer/sonnet', 'src/packs/sonnet')
add_tree('src/components/visualizer/tempera', 'src/packs/tempera')
for name in ['loadPixi', 'pixiTextureBudget', 'pixiDisplayResources', 'colorMix', 'wordColoring']:
    MOVES[f'src/components/visualizer/{name}.ts'] = f'src/engine/shared/{name}.ts'
for name in ['fontStacks', 'colorExtractor', 'colorPalette', 'lucideIconResolver']:
    MOVES[f'src/utils/{name}.ts'] = f'src/engine/shared/{name}.ts'
for name in ['graphemeTiming', 'renderHints', 'wordSegmentation', 'parserCore', 'formatDetection', 'ttmlConversion',
             'timelineSplitter', 'cjkSemanticLayout', 'awlrcContainer', 'foliaLyricDocument']:
    MOVES[f'src/utils/lyrics/{name}.ts'] = f'src/core/lyrics/{name}.ts'

# Targets that are not copied but redirected to a lumisynth module.
REDIRECTS = {
    'src/types.ts': None,  # decided per importer below
    'src/utils/lyrics/types.ts': '@/core/lyrics/types',
}

IMPORT_RE = re.compile(r"""((?:import|export)\s[^;]*?from\s+|import\(\s*)(['"])([^'"]+)\2""", re.S)

def resolve(importer, spec):
    base = os.path.dirname(importer)
    cand = os.path.normpath(os.path.join(base, spec)).replace(os.sep, '/')
    for suf in ['', '.ts', '.tsx', '/index.ts']:
        if os.path.isfile(os.path.join(FOLIA, cand + suf)):
            return cand + suf
    return None

def to_spec(from_new, to_new):
    """Relative inside the same top-level area (pack), `@/` alias across areas."""
    to_no_ext = re.sub(r'\.tsx?$', '', to_new)
    area = lambda p: '/'.join(p.split('/')[:3])  # e.g. src/packs/tempera
    if area(from_new) == area(to_new):
        rel = os.path.relpath(to_no_ext, os.path.dirname(from_new)).replace(os.sep, '/')
        return rel if rel.startswith('.') else './' + rel
    return '@/' + to_no_ext[len('src/'):]

sha1 = lambda t: hashlib.sha1(t.encode('utf-8')).hexdigest()

# Files edited in lumisynth since they were vendored are never overwritten: their on-disk hash no
# longer matches the `vendoredSha1` recorded last time. Upstream fixes to those are ported by hand.
PREVIOUS = {}
manifest_path = os.path.join(OUT, 'docs/vendor-manifest.json')
if os.path.isfile(manifest_path):
    PREVIOUS = {f['to']: f for f in json.load(open(manifest_path, encoding='utf-8'))['files']}

report = {'files': [], 'rewrites': 0, 'unresolved': [], 'kept': []}
for old, new in sorted(MOVES.items()):
    text = open(os.path.join(FOLIA, old), encoding='utf-8').read()
    is_pack = new.startswith('src/packs/')

    def repl(m):
        head, quote, spec = m.group(1), m.group(2), m.group(3)
        if spec == 'framer-motion':
            report['rewrites'] += 1
            return f'{head}{quote}@/packs/_compat/motion{quote}'
        if not spec.startswith('.'):
            return m.group(0)
        target = resolve(old, spec)
        if target is None:
            report['unresolved'].append(f'{old}: {spec}')
            return m.group(0)
        if target == 'src/types.ts':
            new_spec = '@/packs/_compat/foliaTypes' if is_pack else '@/core/types'
        elif target in REDIRECTS:
            new_spec = REDIRECTS[target]
        elif target in MOVES:
            new_spec = to_spec(new, MOVES[target])
        else:
            report['unresolved'].append(f'{old}: {spec} -> {target} (not vendored)')
            return m.group(0)
        if new_spec != spec:
            report['rewrites'] += 1
        return f'{head}{quote}{new_spec}{quote}'

    out = IMPORT_RE.sub(repl, text)
    # The per-file path banner follows the file; @note lines are left exactly as they are.
    out = out.replace(f'// {old}\n', f'// {new}\n')
    dst = os.path.join(OUT, new)
    prev = PREVIOUS.get(new)
    if prev and os.path.isfile(dst) and prev.get('vendoredSha1'):
        if sha1(open(dst, encoding='utf-8').read()) != prev['vendoredSha1']:
            report['kept'].append(new)
            report['files'].append({**prev, 'locallyModified': True, 'latestUpstreamSha1': sha1(text)})
            continue
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    open(dst, 'w', encoding='utf-8', newline='\n').write(out)
    report['files'].append({
        'from': old, 'to': new,
        'upstreamSha1': sha1(text),
        'vendoredSha1': sha1(out),
    })

manifest = {'upstream': 'folia-major', 'commit': UPSTREAM_COMMIT, 'files': report['files']}
os.makedirs(os.path.join(OUT, 'docs'), exist_ok=True)
with open(os.path.join(OUT, 'docs/vendor-manifest.json'), 'w', encoding='utf-8', newline='\n') as f:
    json.dump(manifest, f, indent=2, ensure_ascii=False)
    f.write('\n')
print(f"files={len(report['files'])} rewrites={report['rewrites']}")
for u in report['unresolved']:
    print('UNRESOLVED', u)
for k in report['kept']:
    print('KEPT (locally modified)', k)
