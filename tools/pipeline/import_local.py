"""
Brings your own images (for example AI-generated faces) into a pack's source folder, ready for the cutter.

    python3 -I tools/pipeline/import_local.py [--pack synthetic] [--era synthetic] [--folder tools/pipeline/inbox/<pack>]

File names carry the gender: a leading "m-", "f-" or "a-" means masc, femme or androgynous (anything else is left unlabeled
and shows up in the review page's "needs review" list). The rest of the name becomes the title: "f-03-curly-brown.png" is "curly brown".
Images are converted to JPEG (quality 95, longest side at most 3000 px) because that is what the cutter loads. Re-running skips
images that are already imported (same file name and content).
"""
import argparse, hashlib, json, os, re, sys
from PIL import Image, ImageOps

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
GENDERS = {'m': 'masc', 'f': 'femme', 'a': 'andro'}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pack', default='synthetic')
    ap.add_argument('--era', default=None, help='era id inside the pack (default: the pack id)')
    ap.add_argument('--folder', default=None)
    a = ap.parse_args()
    era = a.era or a.pack
    folder = os.path.abspath(a.folder or os.path.join(ROOT, 'tools', 'pipeline', 'inbox', a.pack))
    out = os.path.join(ROOT, 'tools', 'pipeline', 'cache', a.pack, 'sources', era)
    if not os.path.isdir(folder):
        sys.exit(f'no such folder: {folder}')
    os.makedirs(out, exist_ok=True)
    files = sorted(f for f in os.listdir(folder) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')))
    new = skipped = 0
    for f in files:
        path = os.path.join(folder, f)
        digest = hashlib.sha1(open(path, 'rb').read()).hexdigest()[:8]
        stem = os.path.splitext(f)[0]
        slug = re.sub(r'[^a-z0-9]+', '-', stem.lower()).strip('-')
        oid = f'syn-{slug}-{digest}'
        if os.path.exists(os.path.join(out, oid + '.json')):
            skipped += 1
            continue
        m = re.match(r'^([mfa])[-_ ]', stem.lower())
        gender = GENDERS[m.group(1)] if m else None
        title = re.sub(r'^[mfa][-_ ]\d*[-_ ]?', '', stem, flags=re.I).replace('-', ' ').replace('_', ' ').strip() or stem
        im = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
        if max(im.size) > 3000:
            im.thumbnail((3000, 3000), Image.LANCZOS)
        im.save(os.path.join(out, oid + '.jpg'), 'JPEG', quality=95)
        json.dump({
            'provider': 'local', 'objectId': oid, 'era': era, 'url': '', 'title': title, 'artist': 'AI-generated (fictional person)',
            'date': '', 'medium': 'AI-generated photograph', 'credit': 'AI-generated image of a fictional person; private use only',
            'license': 'private', 'genderGuess': gender,
        }, open(os.path.join(out, oid + '.json'), 'w'), indent=2)
        new += 1
        print(f'  {f} -> {oid}  ({gender or "gender not set"})')
    print(f'{new} imported, {skipped} already there, {len(files)} images in {folder}')

if __name__ == '__main__':
    main()
