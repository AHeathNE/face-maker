import { viewOf, type Gender, type Manifest, type Part, type View } from '@face-maker/face-core';

interface Group { yaw?: number; view: View; key: string; era: string; objectId: string; parts: Part[]; gender: Gender; source: Part['source']; genderSource: string }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const grid = $('grid');
const PACK = new URLSearchParams(location.search).get('pack') ?? 'historic';
let groups: Group[] = [];
let cur = 0;

const isReviewed = (g: Group) => g.genderSource === 'manual' || g.genderSource === 'category';

async function load() {
  const manifest: Manifest = await (await fetch(`/api/manifest?pack=${PACK}`, { cache: 'no-store' })).json();
  const byKey = new Map<string, Group>();
  for (const p of manifest.parts) {
    const key = `${p.era}:${p.source.objectId}`;
    let g = byKey.get(key);
    if (!g) byKey.set(key, (g = { key, era: p.era, objectId: p.source.objectId, parts: [], gender: p.gender, source: p.source, genderSource: p.genderSource ?? 'default' }));
    g.parts.push(p);
  }
  groups = [...byKey.values()];
  for (const g of groups) { g.yaw = g.parts[0].yaw; g.view = viewOf(g.parts[0]); }
  const eras = [...new Set(groups.map((g) => g.era))];
  const sel = $<HTMLSelectElement>('era');
  const prev = sel.value;
  sel.innerHTML = '';
  for (const v of ['all eras', ...eras]) sel.add(new Option(v, v === 'all eras' ? '' : v));
  sel.value = prev;
  render();
}

function visible() {
  const f = $<HTMLSelectElement>('filter').value, era = $<HTMLSelectElement>('era').value;
  const view = $<HTMLSelectElement>('view').value;
  return groups.filter((g) => (!era || g.era === era) && (!view || g.view === view) && (f === 'all' || (f === 'review' ? !isReviewed(g) : g.gender === f)));
}

function render() {
  const list = visible();
  cur = Math.min(cur, Math.max(0, list.length - 1));
  grid.innerHTML = '';
  list.forEach((g, i) => {
    const card = document.createElement('div');
    card.className = 'card' + (i === cur ? ' cur' : '') + (isReviewed(g) ? '' : ' review');
    const face = g.parts.find((p) => p.slot === 'face'), hair = g.parts.find((p) => p.slot === 'hair');
    card.innerHTML = `
      <div class="pic" style="background-image:url('/sources/${PACK}/${g.era}/${g.objectId}.jpg')">
        <div class="parts">${[hair, face].filter(Boolean).map((p) => `<img src="/assets/${PACK}/${p!.file}" loading="lazy">`).join('')}</div>
      </div>
      <div class="title"><b title="${esc(g.source.title)}">${esc(g.source.title)}</b><span>${esc(g.source.artist)} · ${esc(g.source.date)}</span></div>
      <div class="btns">
        ${(['masc', 'femme', 'andro'] as Gender[]).map((v) => `<button data-g="${v}" class="${g.gender === v ? 'on' : ''}">${v}</button>`).join('')}
        <button class="x" data-g="remove" title="Remove this source from the library">✕</button>
      </div>
      <div class="views">
        ${(['front', 'three-quarter', 'profile'] as View[]).map((v, n) => `<button data-v="${v}" class="${g.view === v ? 'on' : ''}" title="key ${n + 1}">${v === 'three-quarter' ? '¾' : v}</button>`).join('')}
      </div>
      <div class="src ${isReviewed(g) ? 'ok' : 'review'}">${g.yaw !== undefined ? `turn ${g.yaw.toFixed(2)} · ` : ''}${isReviewed(g) ? (g.genderSource === 'manual' ? 'reviewed' : 'from category') : g.genderSource === 'guess' ? 'guessed from title' : 'unlabeled default'}</div>`;
    card.onclick = (e) => {
      cur = i;
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.v) setView(g, b.dataset.v as View);
      else if (b) act(g, b.dataset.g as Gender | 'remove');
      else highlight();
    };
    grid.append(card);
  });
  const need = groups.filter((g) => !isReviewed(g)).length;
  $('count').textContent = `${need} to review · ${groups.length} sources · showing ${list.length}`;
}

function highlight() {
  [...grid.children].forEach((c, i) => c.classList.toggle('cur', i === cur));
  (grid.children[cur] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
}

async function act(g: Group, what: Gender | 'remove') {
  if (what === 'remove' && !confirm(`Remove "${g.source.title}" from the library? Its parts are deleted and it won't come back when re-cutting.`)) return;
  const res = await fetch('/api/relabel', { method: 'POST', body: JSON.stringify({ pack: PACK, era: g.era, objectId: g.objectId, gender: what }) });
  if (!res.ok) { $('count').textContent = 'save failed: ' + (await res.text()); return; }
  if (what === 'remove') groups = groups.filter((x) => x !== g);
  else { g.gender = what; g.genderSource = 'manual'; }
  const wasReview = $<HTMLSelectElement>('filter').value === 'review';
  render();
  // In the "needs review" view the card disappears, so the same index is now the next one; otherwise step forward.
  if (!wasReview && what !== 'remove') { cur = Math.min(cur + 1, visible().length - 1); }
  highlight();
}

async function setView(g: Group, view: View) {
  const res = await fetch('/api/relabel', { method: 'POST', body: JSON.stringify({ pack: PACK, era: g.era, objectId: g.objectId, view }) });
  if (!res.ok) { $('count').textContent = 'save failed: ' + (await res.text()); return; }
  g.view = view;
  for (const p of g.parts) p.view = view;
  const stay = cur;
  render();
  cur = Math.min(stay, Math.max(0, visible().length - 1));
  highlight();
}

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName.match(/SELECT|INPUT/)) return;
  const g = visible()[cur];
  const k = e.key.toLowerCase();
  if (k === 'arrowright') { cur = Math.min(cur + 1, visible().length - 1); highlight(); }
  else if (k === 'arrowleft') { cur = Math.max(cur - 1, 0); highlight(); }
  else if (g && k === 'm') act(g, 'masc');
  else if (g && k === 'f') act(g, 'femme');
  else if (g && k === 'a') act(g, 'andro');
  else if (g && k === 'delete') act(g, 'remove');
  else if (g && k === '1') setView(g, 'front');
  else if (g && k === '2') setView(g, 'three-quarter');
  else if (g && k === '3') setView(g, 'profile');
});

$('filter').onchange = $('era').onchange = $('view').onchange = () => { cur = 0; render(); };
$('reload').onclick = load;
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
load();

$('packName').textContent = `· ${PACK}`;
