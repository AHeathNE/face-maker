// Copies the shareable packs into a folder that will be published (a build's dist/packs, or a Pages site's packs/).
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listPacks, packDir, publicInfo, type PackConfig } from './packs.ts';

/** index.json entry: the public facts about a pack plus how many parts it has */
export async function listInfo(packs: PackConfig[]) {
  return Promise.all(packs.map(async (p) => {
    let parts = 0;
    try { parts = JSON.parse(await readFile(join(packDir(p.id), 'manifest.json'), 'utf8')).parts.length; } catch { /* no manifest yet */ }
    return { ...publicInfo(p), parts };
  }));
}

/**
 * Publishes packs into `outDir` and returns their ids. Private packs (shareable: false) are never copied unless
 * `includePrivate` is set. The published copy leaves out the source config (where images were fetched from) and
 * the hand-edit overrides, which only the cutter needs.
 */
export async function publishPacks(outDir: string, opts: { includePrivate?: boolean } = {}): Promise<string[]> {
  const packs = (await listPacks()).filter((p) => p.shareable || opts.includePrivate);
  await mkdir(outDir, { recursive: true });
  for (const p of packs) {
    const dest = join(outDir, p.id);
    await rm(dest, { recursive: true, force: true });
    await cp(packDir(p.id), dest, { recursive: true });
    await rm(join(dest, 'overrides.json'), { force: true });
    const info = JSON.parse(await readFile(join(dest, 'pack.json'), 'utf8'));
    for (const era of info.eras ?? []) delete era.sources;
    await writeFile(join(dest, 'pack.json'), JSON.stringify(info, null, 2));
  }
  await writeFile(join(outDir, 'index.json'), JSON.stringify(await listInfo(packs), null, 2));
  return packs.map((p) => p.id);
}
