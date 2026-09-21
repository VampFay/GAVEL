#!/usr/bin/env python3
"""Compute which src/components/ui/* files are reachable from real app code
(src/app, src/components/gavel, src/hooks) via @/components/ui/* imports,
and which are unreachable dead scaffold (candidates for quarantine)."""
import os, re, glob

SRC = '/home/z/my-project/src'
roots = ['app', 'components/gavel', 'hooks', 'lib', 'middleware.ts']
seen = set()
queue = []

def imports_of(path):
    try:
        text = open(path).read()
    except Exception:
        return []
    mods = re.findall(r"from ['\"]([^'\"]+)['\"]", text)
    out = []
    for m in mods:
        if m.startswith('@/components/ui/'):
            out.append(('ui', m.split('/')[-1]))
        elif m.startswith('./') or m.startswith('../'):
            base = os.path.dirname(path)
            cand = os.path.normpath(os.path.join(base, m))
            for ext in ('.tsx', '.ts', '/index.tsx', '/index.ts'):
                if os.path.exists(cand + ext):
                    out.append(('rel', cand + ext))
                    break
    return out

# seed: everything app code + lib + middleware
for r in roots:
    full = os.path.join(SRC, r)
    if os.path.isfile(full):
        queue.append(full)
    elif os.path.isdir(full):
        for f in glob.glob(full + '/**/*.ts*', recursive=True):
            queue.append(f)

# exclude the dead candidates themselves from seeding (they're not roots)
while queue:
    p = queue.pop()
    if p in seen:
        continue
    seen.add(p)
    for kind, val in imports_of(p):
        if kind == 'ui':
            p2 = os.path.join(SRC, 'components/ui', val if val.endswith('.tsx') else val + '.tsx')
            if os.path.exists(p2):
                queue.append(p2)
        else:
            queue.append(val)

all_ui = sorted(glob.glob(SRC + '/components/ui/*.tsx'))
print("=== REACHABLE ui components (keep):")
keep = [u for u in all_ui if u in seen]
print('\n'.join('  ' + os.path.basename(u) for u in keep))
print("=== UNREACHABLE ui files (quarantine candidates):")
dead = [u for u in all_ui if u not in seen]
print('\n'.join('  ' + os.path.basename(u) for u in dead))
print(f"\nkeep={len(keep)} dead={len(dead)}")
