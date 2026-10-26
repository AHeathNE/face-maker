// Node-side helpers for finding and reading library packs (packs/<id>/pack.json). Used by the pipeline, the cutter and Vite.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../packs');

export interface SourceConfig { provider: string; [key: string]: unknown }
export interface EraConfig { id: string; label: string; sources: SourceConfig[] }

/** What a pack declares about itself. Era ids must be unique across packs (parts from several packs can be mixed). */
export interface PackConfig {
  id: string;
  label: string;
  description?: string;
  /** false = never copied into a public build, and meant to stay out of version control */
  shareable: boolean;
  /** licence names (lower-case, matched as prefixes) a source image may carry to be accepted */
  licenses: string[];
  /** licence names that are refused even if they start like an accepted one (e.g. refuse "cc by-sa" while accepting "cc by") */
  rejectLicenses?: string[];
  eras: EraConfig[];
}

export const packDir = (id: string) => join(PACKS_ROOT, id);

export async function readPack(id: string): Promise<PackConfig> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`bad pack id: ${id}`);
  const pack = JSON.parse(await readFile(join(packDir(id), 'pack.json'), 'utf8')) as PackConfig;
  return { shareable: true, licenses: ['public domain', 'cc0'], ...pack, id };
}

export async function listPacks(): Promise<PackConfig[]> {
  const out: PackConfig[] = [];
  for (const name of await readdir(PACKS_ROOT, { withFileTypes: true }).catch(() => [])) {
    if (!name.isDirectory()) continue;
    try { out.push(await readPack(name.name)); } catch { /* not a pack */ }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** The slice of a pack config that is safe to publish and useful to the apps. */
export const publicInfo = (p: PackConfig) => ({
  id: p.id, label: p.label, description: p.description, shareable: p.shareable,
  eras: p.eras.map((e) => ({ id: e.id, label: e.label })),
});
