import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  GENDERS, VIEWS, viewOf, loadPacks, renderPackPicker, canvasToBlob, makeRng, createPartLoader, partsInPool, randomFace,
  type FaceDoc, type Gender, type View, type Manifest, type RandomOptions,
} from '@face-maker/face-core';
import { Character } from './character.ts';
import { PRESETS, buildHead, type HeadBuild, type HeadShape } from './head.ts';
import { HAIR_STYLES, HAT_STYLES, buildHair, buildHat, hairById, hairTexture, hatTexture } from './shells.ts';
import { createPs1Material, pixelTexture } from './ps1Material.ts';
import { buildHeadTexture } from './texture.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const val = (id: string) => Number($<HTMLInputElement>(id).value);
const checked = (id: string) => $<HTMLInputElement>(id).checked;
const status = (m: string) => { $('status').textContent = m; };
const randomSeed = () => (crypto.getRandomValues(new Uint32Array(1))[0] % 900000) + 100000;
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

let manifest: Manifest = { version: 1, parts: [] };
let loader: ReturnType<typeof createPartLoader>;
let doc: FaceDoc | null = null;
let list: FaceDoc[] = [];
let listIndex = 0;
let eraLabels: Record<string, string> = {};
const genders = new Set<Gender>(GENDERS);
const eras = new Set<string>();
const views = new Set<View>(['front', 'three-quarter']);

// ---------- three ----------
const canvas = $<HTMLCanvasElement>('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
camera.position.set(0.55, 0.12, 3.7);
const controls = new OrbitControls(camera, canvas);
controls.enablePan = false; controls.enableDamping = true; controls.minDistance = 1.8; controls.maxDistance = 6;

const character = new Character();
scene.add(character.root);
const resolution = new THREE.Vector2(320, 240);
let texture = pixelTexture(document.createElement('canvas'));
const material = createPs1Material(texture, { resolution, snap: 1, affine: 1, levels: 32 });
let headMesh: THREE.Mesh | null = null;
let texCanvas: HTMLCanvasElement | null = null;

/** "mix" gives each new face its own head type, picked from the face's seed so it is repeatable. */
function currentPreset(): string {
  const choice = $<HTMLSelectElement>('headType').value;
  if (choice !== 'mix') return choice;
  const seed = doc?.seed || 1;
  return PRESETS[Math.floor(makeRng(seed ^ 0x5bd1e995).next() * PRESETS.length)].id;
}

function shape(): HeadShape {
  return { preset: currentPreset(), width: val('shapeW'), height: val('shapeH'), jaw: val('shapeJaw'), nose: val('shapeNose') };
}

function rebuildHead() {
  const size = val('texSize');
  if (headMesh) { headMesh.geometry.dispose(); }
  const head = buildHead(shape(), size);
  if (!headMesh) { headMesh = new THREE.Mesh(head.geometry, material); headMesh.name = 'head'; character.setSlot('head', headMesh); }
  else headMesh.geometry = head.geometry;
  // centre the head on screen; the neck base stays at the character's neck anchor
  character.root.position.y = -head.centreY;
  lastHead = head;
  rebuildTexture();
  rebuildAccessories();
}

function rebuildTexture() {
  if (!doc) return;
  texCanvas = buildHeadTexture(doc, loader.imageOf, { size: val('texSize'), backColor: $<HTMLInputElement>('backColor').value, paperEdges: checked('paper') });
  texture.dispose();
  texture = pixelTexture(texCanvas);
  material.uniforms.uMap.value = texture;
}

/** hair and hat have their own materials; they share the head's PS1 settings */
let accessoryMats: THREE.ShaderMaterial[] = [];

function applyLook() {
  for (const m of [material, ...accessoryMats]) {
    m.uniforms.uSnap.value = val('snap');
    m.uniforms.uAffine.value = val('affine');
    m.uniforms.uLevels.value = val('levels');
  }
  resize();
}

function accessoryMaterial(canvas: HTMLCanvasElement) {
  const mat = createPs1Material(pixelTexture(canvas), { resolution, snap: val('snap'), affine: val('affine'), levels: val('levels') });
  accessoryMats.push(mat);
  return mat;
}

let lastHead: HeadBuild | null = null;

/** "mix" picks hair from the face's seed, leaning on the gender of the face part so femme faces tend to get longer hair */
function currentHair(): string {
  const choice = $<HTMLSelectElement>('hairType').value;
  if (choice !== 'mix') return choice;
  const face = doc?.layers.find((l) => l.slot === 'face');
  const gender = face ? loader.byId.get(face.partId)?.gender : undefined;
  const pool = gender === 'femme' ? ['long', 'bob', 'long', 'crop', 'bob'] : gender === 'masc' ? ['crop', 'spiky', 'crop', 'none', 'crop'] : ['crop', 'bob', 'spiky', 'long', 'none'];
  return pool[Math.floor(makeRng((doc?.seed || 1) ^ 0x9e3779b9).next() * pool.length)];
}

function rebuildAccessories() {
  for (const m of accessoryMats) { (m.uniforms.uMap.value as THREE.Texture)?.dispose(); }
  accessoryMats = [];
  character.setSlot('hair', null);
  character.setSlot('hat', null);
  if (!lastHead) return;
  const hair = hairById(currentHair());
  if (hair) {
    const mesh = new THREE.Mesh(buildHair(lastHead, hair), accessoryMaterial(hairTexture($<HTMLInputElement>('backColor').value)));
    mesh.name = 'hair';
    character.setSlot('hair', mesh);
  }
  const hatId = $<HTMLSelectElement>('hatType').value;
  if (hatId !== 'none') {
    const geo = buildHat(lastHead, hatId);
    if (geo) {
      const mesh = new THREE.Mesh(geo, accessoryMaterial(hatTexture($<HTMLInputElement>('hatColor').value)));
      mesh.name = 'hat';
      character.setSlot('hat', mesh);
    }
  }
}

function resize() {
  const view = $('view');
  const w = view.clientWidth, h = view.clientHeight;
  if (!w || !h) return;
  const lowH = val('renderH');
  const lowW = Math.max(1, Math.round((lowH * w) / h));
  renderer.setSize(lowW, lowH, false);
  resolution.set(lowW, lowH);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe($('view'));

// ---------- faces ----------
function readOptions(): RandomOptions {
  return { genders: [...genders], views: [...views], eras: [...eras], jitter: val('jitter'), matchingPairs: checked('matching'), consistentGender: checked('consistent') };
}

async function showDoc(next: FaceDoc) {
  await loader.ensure(next);
  doc = next;
  $('seed').textContent = next.seed ? String(next.seed) : '–';
  rebuildHead(); // the head type can depend on the face's seed
}

async function randomize() {
  if (!partsInPool(manifest, readOptions()).length) { status('No parts match this pool.'); return; }
  list = []; listIndex = 0; updatePager();
  await showDoc(randomFace(manifest, readOptions(), randomSeed()));
  status('');
}

function updatePager() {
  $<HTMLButtonElement>('prev').disabled = $<HTMLButtonElement>('next').disabled = list.length < 2;
  $('pagerLabel').textContent = list.length ? `${listIndex + 1} / ${list.length}` : 'random';
}

async function importJson(file: File) {
  try {
    const data = JSON.parse(await file.text());
    const docs: FaceDoc[] = (Array.isArray(data) ? data : data.docs ?? [data.doc ?? data]).filter((d: FaceDoc) => Array.isArray(d?.layers));
    const clean = docs
      .map((d) => ({ ...d, layers: d.layers.filter((l) => loader.byId.has(l.partId)) }))
      .filter((d) => d.layers.length);
    if (!clean.length) { status('No usable faces in that file (parts not in this library?).'); return; }
    list = clean; listIndex = 0; updatePager();
    await showDoc(list[0]);
    status(`imported ${list.length} face${list.length > 1 ? 's' : ''}`);
  } catch (e) { status('Could not read that file: ' + e); }
}

async function step(d: number) {
  if (list.length < 2) return;
  listIndex = (listIndex + d + list.length) % list.length;
  updatePager();
  await showDoc(list[listIndex]);
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- controls ----------
function buildPoolControls() {
  for (const name of GENDERS) {
    const n = manifest.parts.filter((p) => p.gender === name).length;
    const label = document.createElement('label');
    label.className = 'check';
    label.innerHTML = `<input type="checkbox" checked> ${name} <span style="color:var(--dim)">${n}</span>`;
    label.querySelector('input')!.onchange = (e) => { (e.target as HTMLInputElement).checked ? genders.add(name) : genders.delete(name); };
    $('genders').append(label);
  }
  {
  const v = $('views');
  const label0 = { front: 'front', 'three-quarter': '¾ turn', profile: 'profile' } as const;
  for (const name of VIEWS) {
    const n = manifest.parts.filter((p) => p.slot === 'face' && viewOf(p) === name).length;
    const label = document.createElement('label');
    label.className = 'check';
    label.innerHTML = `<input type="checkbox" ${views.has(name) ? 'checked' : ''}> ${label0[name]} <span style="color:var(--dim)">${n}</span>`;
    label.querySelector('input')!.onchange = (e) => { (e.target as HTMLInputElement).checked ? views.add(name) : views.delete(name);  };
    v.append(label);
  }
  }
  const labels = eraLabels;
  return Promise.resolve().then(() => {
    for (const id of new Set(manifest.parts.map((p) => p.era))) {
      eras.add(id);
      const n = manifest.parts.filter((p) => p.era === id).length;
      const label = document.createElement('label');
      label.className = 'check';
      label.innerHTML = `<input type="checkbox" checked> ${esc(labels[id] ?? id)} <span style="color:var(--dim)">${n}</span>`;
      label.querySelector('input')!.onchange = (e) => { (e.target as HTMLInputElement).checked ? eras.add(id) : eras.delete(id); };
      $('eras').append(label);
    }
  });
}

async function init() {
  const packs = await loadPacks();
  manifest = packs.manifest;
  eraLabels = Object.fromEntries(packs.available.flatMap((p) => p.eras.map((e) => [e.id, e.label])));
  renderPackPicker($('packs'), packs.available, packs.selected);
  loader = createPartLoader(manifest);
  const typeSel = $<HTMLSelectElement>('headType');
  const hairSel = $<HTMLSelectElement>('hairType'), hatSel = $<HTMLSelectElement>('hatType');
  hairSel.add(new Option('Mix (varies per face)', 'mix')); hairSel.add(new Option('None', 'none'));
  for (const s of HAIR_STYLES) hairSel.add(new Option(s.label, s.id));
  hatSel.add(new Option('None', 'none'));
  for (const s of HAT_STYLES) hatSel.add(new Option(s.label, s.id));
  typeSel.add(new Option('Mix (varies per face)', 'mix'));
  for (const p of PRESETS) typeSel.add(new Option(p.label, p.id));
  await buildPoolControls();
  applyLook();
  if (!manifest.parts.length) { status('No parts yet — run the cutter and save some approved parts.'); }
  else await randomize();
  rebuildHead();

  $('randomize').onclick = randomize;
  $('prev').onclick = () => step(-1);
  $('next').onclick = () => step(1);
  $('importFile').onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) importJson(f); };
  for (const id of ['shapeW', 'shapeH', 'shapeJaw', 'shapeNose']) $(id).oninput = rebuildHead;
  typeSel.onchange = rebuildHead;
  for (const id of ['backColor', 'paper']) $(id).oninput = () => { rebuildTexture(); rebuildAccessories(); };
  hairSel.onchange = hatSel.onchange = () => rebuildAccessories();
  $('hatColor').oninput = rebuildAccessories;
  $('texSize').onchange = rebuildHead;
  for (const id of ['snap', 'affine', 'levels', 'renderH']) $(id).oninput = applyLook;
  $('savePng').onclick = async () => {
    renderer.render(scene, camera);
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    c.getContext('2d')!.drawImage(canvas, 0, 0);
    download(await canvasToBlob(c), `head-${doc?.seed ?? 'face'}.png`);
  };
  $('saveTex').onclick = async () => { if (texCanvas) download(await canvasToBlob(texCanvas), `head-texture-${doc?.seed ?? 'face'}.png`); };

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    controls.update();
    character.root.rotation.y = checked('spin') ? Math.sin(clock.getElapsedTime() * 0.7) * 0.5 : 0;
    renderer.render(scene, camera);
  });
  (window as any).__app = { renderer, scene, camera, character, controls, ready: true };
}
init().catch((e) => { status('init failed: ' + e); console.error(e); });
