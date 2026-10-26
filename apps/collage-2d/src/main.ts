import { zipSync } from 'fflate';
import {
  GENDERS, VIEWS, viewOf, loadPacks, partUrl, renderPackPicker, SLOT_ORDER, canvasToBlob, makeLayer, newLayerId, partsInPool, randomFace, renderFace, rerollLayer,
  type FaceDoc, type Gender, type View, type Manifest, type Part, type RandomOptions, type RenderStyle, type Slot,
} from '@face-maker/face-core';
import { Editor } from './editor.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const STORE = 'facemaker.collage.v1';
const randomSeed = () => (crypto.getRandomValues(new Uint32Array(1))[0] % 900000) + 100000;

let manifest: Manifest = { version: 1, parts: [] };
let eraLabels: Record<string, string> = {};
const partById = new Map<string, Part>();
const images = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<void>>();
let editor: Editor;
let tab: Slot = 'face';

// ---------- options ----------
const genders = new Set<Gender>(GENDERS);
const eras = new Set<string>();
// Profile heads make poor collage parts, so they start switched off (they are still in the library).
const views = new Set<View>(['front', 'three-quarter']);

function readOptions(): RandomOptions {
  return {
    genders: [...genders], views: [...views], eras: [...eras],
    jitter: Number($<HTMLInputElement>('jitter').value),
    matchingPairs: $<HTMLInputElement>('matching').checked,
    consistentGender: $<HTMLInputElement>('consistent').checked,
  };
}
function readStyle(): RenderStyle {
  return { outline: $<HTMLInputElement>('borderOn').checked ? Number($<HTMLInputElement>('outline').value) : 0, outlineColor: $<HTMLInputElement>('outlineColor').value, shadow: $<HTMLInputElement>('shadow').checked };
}
const status = (msg: string) => { $('status').textContent = msg; };

// ---------- images ----------
function loadPart(id: string): Promise<void> {
  if (images.has(id)) return Promise.resolve();
  let p = pending.get(id);
  if (!p) {
    const part = partById.get(id);
    p = new Promise<void>((resolve) => {
      if (!part) return resolve();
      const img = new Image();
      img.onload = () => { images.set(id, img); resolve(); };
      img.onerror = () => resolve();
      img.src = partUrl(part);
    });
    pending.set(id, p);
  }
  return p;
}
const ensureImages = (doc: FaceDoc) => Promise.all(doc.layers.map((l) => loadPart(l.partId))).then(() => undefined);
const imageOf = (id: string) => images.get(id);

// ---------- persistence ----------
function persist() {
  try { localStorage.setItem(STORE, JSON.stringify({ doc: editor.doc })); } catch { /* storage may be unavailable */ }
}
function restore(): FaceDoc | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null')?.doc as FaceDoc | undefined;
    if (!saved?.layers) return null;
    const layers = saved.layers.filter((l) => partById.has(l.partId));
    return layers.length ? { ...saved, layers } : null;
  } catch { return null; }
}

// ---------- actions ----------
async function randomize() {
  if (!partsInPool(manifest, readOptions()).length) { status('No parts match this pool — enable more genders or eras.'); return; }
  const seed = randomSeed();
  const doc = randomFace(manifest, readOptions(), seed);
  await ensureImages(doc);
  editor.setDoc(doc);
  $('seed').textContent = String(seed);
  persist(); refreshPalette(); status('');
}

function insertLayer(doc: FaceDoc, layer: FaceDoc['layers'][number]) {
  const order = (s: Slot) => SLOT_ORDER.indexOf(s);
  let at = doc.layers.length;
  for (let i = 0; i < doc.layers.length; i++) if (order(doc.layers[i].slot) > order(layer.slot)) { at = i; break; }
  doc.layers.splice(at, 0, layer);
}

async function addOrSwap(part: Part) {
  await loadPart(part.id);
  const doc = editor.doc;
  const sel = editor.selected;
  if (sel && sel.slot === part.slot) {
    sel.partId = part.id;
  } else {
    const layer = makeLayer(part, doc.layers.filter((l) => l.slot === part.slot).length, doc.size);
    insertLayer(doc, layer);
    editor.selectedId = layer.id;
  }
  editor.setDoc(doc, true);
  editor.select(editor.selectedId);
  persist(); refreshPalette();
}

async function tool(act: string) {
  const doc = editor.doc, sel = editor.selected;
  if (!sel) return;
  const i = doc.layers.indexOf(sel);
  if (act === 'flip') sel.flipX = !sel.flipX;
  else if (act === 'flipy') sel.flipY = !sel.flipY;
  else if (act === 'mirror') {
    const axis = doc.size / 2;
    if (Math.abs(sel.x - axis) < 12) sel.flipX = !sel.flipX; // already on the centre line: nothing to copy across
    else {
      const m = { ...sel, id: newLayerId(sel.slot), x: 2 * axis - sel.x, rotation: -sel.rotation, flipX: !sel.flipX };
      doc.layers.splice(i + 1, 0, m);
      editor.selectedId = m.id;
    }
  }
  else if (act === 'delete') { doc.layers.splice(i, 1); editor.selectedId = null; }
  else if (act === 'dup') { const c = { ...sel, id: newLayerId(sel.slot), x: sel.x + 30, y: sel.y + 30 }; doc.layers.splice(i + 1, 0, c); editor.selectedId = c.id; }
  else if (act === 'back' && i > 0) [doc.layers[i - 1], doc.layers[i]] = [doc.layers[i], doc.layers[i - 1]];
  else if (act === 'front' && i < doc.layers.length - 1) [doc.layers[i + 1], doc.layers[i]] = [doc.layers[i], doc.layers[i + 1]];
  else if (act === 'reroll') {
    const next = rerollLayer(doc, sel.id, manifest, readOptions(), randomSeed());
    await ensureImages(next);
    editor.setDoc(next, true); editor.select(sel.id); persist(); refreshPalette();
    return;
  }
  editor.setDoc(doc, true);
  editor.select(editor.selectedId);
  persist(); refreshPalette();
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const exportOpts = () => ({ scale: Number($<HTMLSelectElement>('exportSize').value) / DOC_SIZE(), trim: $<HTMLInputElement>('trim').checked });
const DOC_SIZE = () => editor.doc.size;

async function exportPng() {
  const canvas = renderFace(editor.doc, imageOf, readStyle(), exportOpts());
  download(await canvasToBlob(canvas), `face-${editor.doc.seed}.png`);
  status(`saved ${canvas.width}×${canvas.height} PNG`);
}

/** A face file is just the doc (parts + placement) plus the look it was made with, so the 3D app can open it too. */
function saveJson() {
  const body = { kind: 'face-maker-face', version: 1, doc: editor.doc, style: readStyle() };
  download(new Blob([JSON.stringify(body, null, 1)], { type: 'application/json' }), `face-${editor.doc.seed}.json`);
  status('saved face file');
}

async function openJson(file: File) {
  try {
    const data = JSON.parse(await file.text());
    const raw = data.doc ?? data.docs?.[0] ?? data;
    if (!Array.isArray(raw?.layers)) throw new Error('not a face file');
    const layers = raw.layers.filter((l: { partId: string }) => partById.has(l.partId));
    if (!layers.length) { status('None of that face\'s parts are in this library.'); return; }
    const doc: FaceDoc = { version: 1, size: raw.size ?? editor.doc.size, seed: raw.seed ?? 0, layers };
    await ensureImages(doc);
    editor.setDoc(doc);
    $('seed').textContent = doc.seed ? String(doc.seed) : '–';
    persist(); refreshPalette();
    status(layers.length < raw.layers.length ? `opened (${raw.layers.length - layers.length} missing parts skipped)` : 'opened face file');
  } catch (e) { status('Could not open that file: ' + e); }
}

async function exportBatch() {
  const n = Math.max(1, Math.min(500, Number($<HTMLInputElement>('batchCount').value) || 1));
  const opts = readOptions(), style = readStyle(), ex = exportOpts();
  if (!partsInPool(manifest, opts).length) { status('No parts match this pool.'); return; }
  const files: Record<string, [Uint8Array, { level: 0 }] | Uint8Array> = {};
  const docs: FaceDoc[] = [];
  const btn = $<HTMLButtonElement>('batch');
  btn.disabled = true;
  for (let i = 0; i < n; i++) {
    const doc = randomFace(manifest, opts, randomSeed());
    await ensureImages(doc);
    const blob = await canvasToBlob(renderFace(doc, imageOf, style, ex));
    files[`face-${String(i + 1).padStart(3, '0')}-s${doc.seed}.png`] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
    docs.push(doc);
    status(`rendering ${i + 1}/${n}…`);
    await new Promise((r) => setTimeout(r));
  }
  files['faces.json'] = new TextEncoder().encode(JSON.stringify({ options: opts, style, docs }, null, 1));
  download(new Blob([zipSync(files as never)], { type: 'application/zip' }), `faces-${n}.zip`);
  btn.disabled = false;
  status(`saved zip with ${n} faces`);
}

// ---------- palette ----------
function refreshPalette() {
  const pool = partsInPool(manifest, readOptions());
  const slots = SLOT_ORDER.filter((s) => manifest.parts.some((p) => p.slot === s));
  if (!slots.includes(tab)) tab = slots[0] ?? 'face';
  const tabs = $('tabs');
  tabs.innerHTML = '';
  for (const s of slots) {
    const b = document.createElement('button');
    b.textContent = `${s} ${pool.filter((p) => p.slot === s).length}`;
    b.className = s === tab ? 'on' : '';
    b.onclick = () => { tab = s; refreshPalette(); };
    tabs.append(b);
  }
  const current = editor?.selected?.partId;
  const pal = $('palette');
  pal.innerHTML = '';
  const list = pool.filter((p) => p.slot === tab);
  if (!list.length) { pal.innerHTML = '<div class="empty">No parts for this slot in the current pool.</div>'; return; }
  for (const part of list) {
    const d = document.createElement('div');
    d.className = 'thumb' + (part.id === current ? ' cur' : '');
    d.title = `${part.source.title} — ${part.source.artist} (${part.gender})`;
    const img = document.createElement('img');
    img.loading = 'lazy'; img.src = partUrl(part);
    d.append(img);
    d.onclick = () => addOrSwap(part);
    pal.append(d);
  }
}

function showCredits() {
  const seen = new Map<string, Part['source'] & { license: string }>();
  for (const p of manifest.parts) seen.set(`${p.source.provider}:${p.source.objectId}`, { ...p.source, license: p.license });
  $('creditsBody').innerHTML = `<p>${seen.size} source works, each listed with its licence.</p>` + [...seen.values()].map((s) =>
    `<p><b>${esc(s.title)}</b> — ${esc(s.artist)}, ${esc(s.date)} · ${s.license} · <a style="color:#8ab4f8" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.provider)}</a><br>${esc(s.credit)}</p>`).join('');
  $<HTMLDialogElement>('creditsDialog').showModal();
}
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// ---------- init ----------
function buildPoolControls() {
  const g = $('genders');
  for (const name of GENDERS) {
    const n = manifest.parts.filter((p) => p.gender === name).length;
    const label = document.createElement('label');
    label.className = 'check';
    label.innerHTML = `<input type="checkbox" checked> ${name} <span style="color:var(--dim)">${n}</span>`;
    label.querySelector('input')!.onchange = (e) => { (e.target as HTMLInputElement).checked ? genders.add(name) : genders.delete(name); refreshPalette(); };
    g.append(label);
  }
  const v = $('views');
  const label0 = { front: 'front', 'three-quarter': '¾ turn', profile: 'profile' } as const;
  for (const name of VIEWS) {
    const n = manifest.parts.filter((p) => p.slot === 'face' && viewOf(p) === name).length;
    const label = document.createElement('label');
    label.className = 'check';
    label.innerHTML = `<input type="checkbox" ${views.has(name) ? 'checked' : ''}> ${label0[name]} <span style="color:var(--dim)">${n}</span>`;
    label.querySelector('input')!.onchange = (e) => { (e.target as HTMLInputElement).checked ? views.add(name) : views.delete(name); refreshPalette(); };
    v.append(label);
  }
  const e = $('eras');
  for (const id of [...new Set(manifest.parts.map((p) => p.era))]) {
    eras.add(id);
    const n = manifest.parts.filter((p) => p.era === id).length;
    const label = document.createElement('label');
    label.className = 'check';
    label.innerHTML = `<input type="checkbox" checked> ${esc(eraLabels[id] ?? id)} <span style="color:var(--dim)">${n}</span>`;
    label.querySelector('input')!.onchange = (ev) => { (ev.target as HTMLInputElement).checked ? eras.add(id) : eras.delete(id); refreshPalette(); };
    e.append(label);
  }
}

async function init() {
  const packs = await loadPacks();
  manifest = packs.manifest;
  eraLabels = Object.fromEntries(packs.available.flatMap((p) => p.eras.map((e) => [e.id, e.label])));
  renderPackPicker($('packs'), packs.available, packs.selected);
  for (const p of manifest.parts) partById.set(p.id, p);
  buildPoolControls();

  const first = restore() ?? (manifest.parts.length ? randomFace(manifest, readOptions(), randomSeed()) : { version: 1 as const, size: 1024, seed: 0, layers: [] });
  await ensureImages(first);
  editor = new Editor($('stage'), first, imageOf, readStyle);
  editor.onEdit = persist;
  editor.onSelect = (id) => { $('selTools').style.opacity = id ? '1' : '.5'; refreshPalette(); };
  editor.setDoc(first);
  $('seed').textContent = first.seed ? String(first.seed) : '–';
  refreshPalette();
  if (!manifest.parts.length) status('No parts yet — run the cutter and save some approved parts.');

  $('randomize').onclick = randomize;
  $('exportPng').onclick = exportPng;
  $('saveJson').onclick = saveJson;
  $<HTMLInputElement>('openJson').onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) openJson(f); (e.target as HTMLInputElement).value = ''; };
  $('batch').onclick = exportBatch;
  $('credits').onclick = showCredits;
  const syncBorderControls = () => { $<HTMLInputElement>('outline').disabled = $<HTMLInputElement>('outlineColor').disabled = !$<HTMLInputElement>('borderOn').checked; };
  for (const id of ['borderOn', 'outline', 'outlineColor', 'shadow']) $(id).oninput = () => { syncBorderControls(); editor.rebuild(); };
  document.querySelectorAll<HTMLButtonElement>('#selTools [data-act]').forEach((b) => { b.onclick = () => tool(b.dataset.act!); });
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName.match(/INPUT|SELECT|TEXTAREA/)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') tool('delete');
    if (e.key === ' ') { e.preventDefault(); randomize(); }
  });
  (window as any).__app = { editor, randomize, manifest };
}
init().catch((e) => { status('init failed: ' + e); console.error(e); });
