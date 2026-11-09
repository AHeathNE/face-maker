"""
Builds deliberately low-quality ("crunched") copies of a library pack, as new packs next to the original. The original is never touched.

    python3 -I tools/crunch/crunch.py [--from historic] [--levels light,medium,heavy]

Each level writes packs/<from>-crunch-<level>/ with a manifest, pack.json and lossy WebP parts:
  light   full size, WebP quality 55 (grain and fine detail disappear, edges stay)
  medium  half-size blocks, WebP quality 35 (visible blocks and smearing)
  heavy   quarter-size blocks, WebP quality 18 (chunky, smeared, very small)
Era and part ids get a "-<level>" suffix so a crunched pack can be switched on beside the original in the apps.
These packs are marked "shareable": false, so a public build never includes them, and they are listed in .gitignore.
Re-run after the source pack changes (new parts, relabelled genders, removed sources); it rebuilds each level from scratch.
"""
import argparse, io, json, os, shutil, sys
from multiprocessing import Pool
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
PACKS = os.path.join(ROOT, 'packs')

LEVELS = {
    'light':  dict(block=1.0,  quality=55, alpha=80, label='crunch: light'),
    'medium': dict(block=0.5,  quality=35, alpha=55, label='crunch: medium'),
    'heavy':  dict(block=0.25, quality=18, alpha=35, label='crunch: heavy'),
}

def crunch_image(src, dst, level):
    cfg = LEVELS[level]
    im = Image.open(src).convert('RGBA')
    if cfg['block'] < 1.0:
        w, h = im.size
        small = im.resize((max(6, round(w * cfg['block'])), max(6, round(h * cfg['block']))), Image.BILINEAR)
        im = small.resize((w, h), Image.NEAREST)  # blocks, so the crunch is visible instead of just soft
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    im.save(dst, 'WEBP', quality=cfg['quality'], alpha_quality=cfg['alpha'], method=6)
    return os.path.getsize(dst)

def job(args):
    return crunch_image(*args)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--from', dest='src', default='historic')
    ap.add_argument('--levels', default='light,medium,heavy')
    a = ap.parse_args()
    src_dir = os.path.join(PACKS, a.src)
    manifest = json.load(open(os.path.join(src_dir, 'manifest.json')))
    pack = json.load(open(os.path.join(src_dir, 'pack.json')))
    for level in a.levels.split(','):
        cfg = LEVELS[level]
        pid = f'{a.src}-crunch-{level}'
        out = os.path.join(PACKS, pid)
        if os.path.exists(out): shutil.rmtree(out)
        os.makedirs(os.path.join(out, 'parts'))
        parts, jobs = [], []
        for p in manifest['parts']:
            era2 = f"{p['era']}-{level}"
            file2 = os.path.splitext(p['file'].replace(p['era'] + '/', era2 + '/', 1))[0] + '.webp'
            q = dict(p)
            q['era'] = era2
            q['id'] = p['id'].replace(p['era'], era2, 1) if p['id'].startswith(p['era']) else f'{era2}-{p["id"]}'
            q['file'] = file2
            parts.append(q)
            jobs.append((os.path.join(src_dir, 'parts', p['file']), os.path.join(out, 'parts', file2), level))
        with Pool(3) as pool:
            sizes = pool.map(job, jobs, chunksize=20)
        json.dump({'version': 1, 'parts': parts}, open(os.path.join(out, 'manifest.json'), 'w'))
        json.dump({}, open(os.path.join(out, 'overrides.json'), 'w'))
        json.dump({
            'id': pid, 'label': f"{pack['label']} ({cfg['label']})", 'shareable': False,
            'description': f"Experimental crunched copy of {a.src}. Not for publishing.",
            'licenses': pack.get('licenses', []), 'eras': [{'id': f"{e['id']}-{level}", 'label': f"{e['label']} ({cfg['label']})", 'sources': []} for e in pack['eras']],
        }, open(os.path.join(out, 'pack.json'), 'w'), indent=2)
        orig = sum(os.path.getsize(os.path.join(src_dir, 'parts', p['file'])) for p in manifest['parts'])
        print(f"{pid}: {len(parts)} parts, {sum(sizes)/1e6:.1f} MB (original {orig/1e6:.0f} MB, {100*sum(sizes)/orig:.1f}%)", flush=True)

if __name__ == '__main__':
    main()
