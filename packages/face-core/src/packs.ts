import type { Manifest } from './types.ts';

export interface PackInfo {
  id: string;
  label: string;
  description?: string;
  shareable: boolean;
  /** how many parts the pack has (0 = not cut yet) */
  parts?: number;
  eras: { id: string; label: string }[];
}

const KEY = 'facemaker.packs';

/** Where the packs are served from. The default is next to the page; a deployment with several apps can point elsewhere. */
export const PACKS_BASE: string = (import.meta as unknown as { env?: { VITE_PACKS_BASE?: string } }).env?.VITE_PACKS_BASE ?? 'packs/';

/** Which packs to use: ?pack=a,b (or ?pack=all) wins, then the last choice, then the first pack. */
function choose(available: PackInfo[]): string[] {
  const ids = new Set(available.map((p) => p.id));
  const param = new URLSearchParams(location.search).get('pack');
  let want: string[] = [];
  if (param) want = param === 'all' ? [...ids] : param.split(',');
  else { try { want = JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { /* storage unavailable */ } }
  want = want.filter((id) => ids.has(id));
  const filled = available.filter((p) => (p.parts ?? 1) > 0);
  return want.length ? want : filled.length ? [filled[0].id] : available.length ? [available[0].id] : [];
}

/**
 * Loads the selected packs and merges them into one manifest. Era ids are unique across packs, so the apps can treat
 * the result like a single library, with each part remembering its pack for its image URL and credits.
 */
export async function loadPacks(): Promise<{ manifest: Manifest; available: PackInfo[]; selected: string[] }> {
  const available: PackInfo[] = await (await fetch(`${PACKS_BASE}index.json`, { cache: 'no-store' })).json();
  const selected = choose(available);
  const merged: Manifest = { version: 1, parts: [] };
  for (const id of selected) {
    try {
      const m: Manifest = await (await fetch(`${PACKS_BASE}${id}/manifest.json`, { cache: 'no-store' })).json();
      merged.parts.push(...m.parts.map((p) => ({ ...p, pack: id })));
    } catch { /* a pack with no manifest yet is just empty */ }
  }
  return { manifest: merged, available, selected };
}

/** Checkboxes for the available packs. Changing the choice remembers it and reloads, which swaps the library. */
export function renderPackPicker(container: HTMLElement, available: PackInfo[], selected: string[]) {
  container.innerHTML = '';
  if (available.length < 2) { container.hidden = true; return; }
  for (const p of available) {
    const label = document.createElement('label');
    label.className = 'check';
    label.title = p.description ?? '';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = selected.includes(p.id);
    box.onchange = () => {
      const next = available.filter((q) => (q.id === p.id ? box.checked : selected.includes(q.id))).map((q) => q.id);
      if (!next.length) { box.checked = true; return; }
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      const url = new URL(location.href);
      url.searchParams.delete('pack');
      location.href = url.toString();
    };
    label.append(box, ` ${p.label}${p.shareable ? '' : ' (private)'}${p.parts === 0 ? ' (empty)' : ''}`);
    container.append(label);
  }
}
