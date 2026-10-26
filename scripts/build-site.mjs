// Builds the whole public site into ./site:
//   site/index.html   landing page
//   site/collage/     the 2D app
//   site/ps1/         the 3D app
//   site/packs/       the shareable library packs, published once and shared by both apps
//
//   node scripts/build-site.mjs
import { build } from 'vite';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPacks } from '../packages/assets/packs.ts';
import { publishPacks } from '../packages/assets/publish.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'site');

await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });

// The apps live one folder down, so they reach the shared packs at ../packs/, and must not each publish a copy.
process.env.FACE_MAKER_PACKS = 'external';
process.env.VITE_PACKS_BASE = '../packs/';
for (const [app, dir] of [['collage-2d', 'collage'], ['ps1-3d', 'ps1']]) {
  await build({ root: join(root, 'apps', app), logLevel: 'warn', build: { outDir: join(site, dir), emptyOutDir: true } });
  console.log(`built ${app} -> site/${dir}/`);
}

const published = await publishPacks(join(site, 'packs'));
console.log(`published packs: ${published.join(', ') || '(none)'}`);

// Safety check: a pack marked private must not be anywhere in the site, and every published pack must say it is shareable.
const all = await listPacks();
const privateIds = all.filter((p) => !p.shareable).map((p) => p.id);
const onDisk = await readdir(join(site, 'packs'), { withFileTypes: true });
for (const d of onDisk.filter((d) => d.isDirectory())) {
  const cfg = JSON.parse(await readFile(join(site, 'packs', d.name, 'pack.json'), 'utf8'));
  if (cfg.shareable === false || privateIds.includes(d.name)) throw new Error(`refusing to publish private pack "${d.name}"`);
}
if (!published.length) throw new Error('no shareable packs to publish');

await cp(join(root, 'scripts/site/index.html'), join(site, 'index.html'));
await writeFile(join(site, '.nojekyll'), '');

async function size(dir) {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) n += e.isDirectory() ? await size(join(dir, e.name)) : (await stat(join(dir, e.name))).size;
  return n;
}
console.log(`site ready: ${(await size(site) / 1e6).toFixed(1)} MB; private packs left out: ${privateIds.join(', ') || 'none'}`);
