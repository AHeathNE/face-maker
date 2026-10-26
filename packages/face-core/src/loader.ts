import type { FaceDoc } from './doc.ts';
import { PACKS_BASE } from './packs.ts';
import type { Manifest, Part } from './types.ts';

/** Loads part PNGs on demand and caches them. `baseUrl` is where manifest `file` paths live (e.g. "parts/"). */
/** URL of a part's PNG. Parts loaded from a pack carry `pack`; older single-library manifests use plain `parts/`. */
export const partUrl = (p: Part, legacyBase = 'parts/') => (p.pack ? `${PACKS_BASE}${p.pack}/parts/${p.file}` : legacyBase + p.file);

export function createPartLoader(manifest: Manifest, baseUrl = 'parts/') {
  const byId = new Map<string, Part>(manifest.parts.map((p) => [p.id, p]));
  const images = new Map<string, HTMLImageElement>();
  const pending = new Map<string, Promise<void>>();

  const load = (id: string): Promise<void> => {
    if (images.has(id)) return Promise.resolve();
    let p = pending.get(id);
    if (!p) {
      const part = byId.get(id);
      p = new Promise<void>((resolve) => {
        if (!part) return resolve();
        const img = new Image();
        img.onload = () => { images.set(id, img); resolve(); };
        img.onerror = () => resolve();
        img.src = partUrl(part, baseUrl);
      });
      pending.set(id, p);
    }
    return p;
  };

  return {
    byId,
    load,
    imageOf: (id: string) => images.get(id),
    ensure: (doc: FaceDoc) => Promise.all(doc.layers.map((l) => load(l.partId))).then(() => undefined),
  };
}
