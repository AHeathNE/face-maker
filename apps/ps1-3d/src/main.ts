import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  GENDERS, VIEWS, viewOf, loadPacks, renderPackPicker, trimToContent, canvasToBlob, makeRng, createPartLoader, partsInPool, randomFace,
  type FaceDoc, type Gender, type View, type Slot, type Manifest, type RandomOptions,
} from '@face-maker/face-core';
import { Character } from './character.ts';
import { PRESETS, buildHead, type HeadBuild, type HeadShape } from './head.ts';
import { exportObj, exportStl } from './export3d.ts';
import { zipSync } from 'fflate';
import { buildPaperModel, type PieceInput, type P2, type P3 } from './papercraft.ts';
import { makePdf } from './pdf.ts';
import { BUILDS, SHOULDER_STYLES, buildBody, type BodyBuild } from './body.ts';
import { OUTFITS, outfitById, paintOutfit } from './outfit.ts';
import { JOINT_LABELS, JOINT_NAMES, POSES, applyPose, fullPose, mirrorPose, type Pose, type Rot } from './poses.ts';
import { HAIR_STYLES, HAT_STYLES, buildHair, buildHat, hairById, hairTexture, hatTexture } from './shells.ts';
import { createPs1Material, pixelTexture } from './ps1Material.ts';
import { buildHeadTexture, partColourHex, skinColourHex } from './texture.ts';
import type { SkinSurface } from './skinSurface.ts';

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
// The 3D head works best from straight-on faces, so only those are used by default (the other angles can be switched back on).
const views = new Set<View>(['front']);

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
material.name = 'head';
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
  lastHead = head;
  rebuildTexture();
  rebuildAccessories();
  rebuildBody(false);
}

function rebuildTexture() {
  if (!doc) return;
  // a mohawk leaves the rest of the scalp bare, so the head's own hair area becomes stubble
  const bare = hairById(currentHair())?.crest;
  const backColor = bare ? new THREE.Color(skinHex()).multiplyScalar(0.55).getStyle() : hairHex();
  // By default the texture is only the eyes, brows, nose and mouth laid on the skin tone. The face-base oval, and the collage's hair
  // and ear parts, are switches (the 3D head has its own hair and ears).
  const exclude: Slot[] = [];
  if (!checked('useFaceBase')) exclude.push('face');
  if (!checked('useHairEars')) exclude.push('hair', 'ear');
  texCanvas = buildHeadTexture(doc, loader.imageOf, { size: val('texSize'), backColor, paperEdges: checked('paper'), exclude, skinSurface: { style: $<HTMLSelectElement>('skinSurf').value as SkinSurface, amt: val('skinSurfAmt') } });
  texture.dispose();
  texture = pixelTexture(texCanvas);
  material.uniforms.uMap.value = texture;
  updateHeadHatch();
}

/** hair and hat have their own materials; they share the head's PS1 settings */
let accessoryMats: THREE.ShaderMaterial[] = [];
let bodyMats: THREE.ShaderMaterial[] = [];
let bodyBuild: BodyBuild | null = null;
let restMinY = 0;
let restPelvisY = 0;

function applyLook() {
  for (const m of [material, ...accessoryMats, ...bodyMats]) {
    const wobble = checked('wobbleOn'); // the master switch: off means steady vertices and normal texture mapping
    m.uniforms.uSnap.value = wobble ? val('snap') : 0;
    m.uniforms.uAffine.value = wobble ? val('affine') : 0;
    m.uniforms.uLevels.value = val('levels');
  }
  resize();
}

function accessoryMaterial(canvas: HTMLCanvasElement, name: string) {
  const mat = createPs1Material(pixelTexture(canvas), { resolution, snap: val('snap'), affine: val('affine'), levels: val('levels') }, true);
  mat.name = name;
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

/** Keeps the figure centred: just the head by default, or the whole body when it is shown. */
function positionCharacter() {
  if (!lastHead) return;
  const mid = bodyBuild ? (bodyBuild.floorY + lastHead.headTop) / 2 : lastHead.centreY;
  character.root.position.y = -mid;
}

/** Backs the camera up to fit a full body, or brings it close for a head. Only done when the body is toggled, so orbiting is not undone. */
function frameCamera() {
  if (!lastHead) return;
  const dir = camera.position.clone().sub(controls.target).normalize();
  const height = bodyBuild ? lastHead.headTop - bodyBuild.floorY : 2.6;
  const dist = bodyBuild ? height * 1.95 : 3.7;
  controls.minDistance = dist * 0.5; controls.maxDistance = dist * 1.8;
  camera.position.copy(controls.target).addScaledVector(dir, dist);
  controls.update();
}

/** The hair colour: from the collage's own hair photo when it has one (and the switch is on), otherwise the colour picker. Never pure black. */
function hairHex(): string {
  const manual = $<HTMLInputElement>('backColor').value;
  if (!checked('hairAuto') || !doc) return manual;
  const fromPhoto = partColourHex(doc, loader.imageOf, 'hair');
  if (!fromPhoto) return manual;
  const c = new THREE.Color(fromPhoto);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0.16, hsl.l));
  return '#' + c.getHexString();
}

/** Engravings and other greyscale faces would give a dead grey body, so low-saturation skin is warmed toward a natural tone. */
function warmSkin(hex: string): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  if (hsl.s < 0.22) {
    const t = 1 - hsl.s / 0.22;
    hsl.h = hsl.h + (0.065 - hsl.h) * t;
    hsl.s = hsl.s + (0.4 - hsl.s) * t;
    hsl.l = Math.min(0.72, Math.max(0.4, hsl.l * 1.15));
    c.setHSL(hsl.h, hsl.s, hsl.l);
  }
  return '#' + c.getHexString();
}

function skinHex(): string {
  if (!checked('skinAuto') || !doc) return $<HTMLInputElement>('colSkin').value;
  const face = skinColourHex(doc, loader.imageOf);
  return checked('skinWarm') ? warmSkin(face) : face; // by default the body matches the face exactly, grey engraving included
}

/** the head's flat-colour corner texels (back of the head, ears, neck) are hatched too, by the shader, when hatching is on */
function updateHeadHatch() {
  const size = texCanvas?.width ?? val('texSize');
  const tex = doc ? skinTexture(skinHex()) : { hatch: false, speckle: false };
  material.uniforms.uHatch.value = tex.hatch ? 1 : 0;
  material.uniforms.uSpeckle.value = tex.speckle ? 1 : 0;
  material.uniforms.uTexStrength.value = val('texStrength');
  material.uniforms.uSkinSurf.value = { none: 0, soft: 1, grain: 2, freckled: 3 }[$<HTMLSelectElement>('skinSurf').value as SkinSurface];
  material.uniforms.uSkinAmt.value = val('skinSurfAmt');
  material.uniforms.uReserved.value.set(8 / size, 1 - 4 / size);
}

/** which engraving-style textures the skin gets: chosen in the menu, or for "auto" hatched + speckled when the face is greyscale */
function skinTexture(skin: string): { hatch: boolean; speckle: boolean } {
  const mode = $<HTMLSelectElement>('skinHatch').value;
  if (mode === 'none') return { hatch: false, speckle: false };
  if (mode === 'hatch') return { hatch: true, speckle: false };
  if (mode === 'speckle') return { hatch: false, speckle: true };
  if (mode === 'both') return { hatch: true, speckle: true };
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(skin).getHSL(hsl);
  const grey = hsl.s < 0.16;
  return { hatch: grey, speckle: grey };
}

function rebuildBody(reframe: boolean) {
  for (const mat of bodyMats) (mat.uniforms.uMap.value as THREE.Texture)?.dispose();
  bodyMats = [];
  character.setSlot('body', null);
  const had = bodyBuild !== null;
  // the head (with hair and hat) must leave the old body before it is disposed, or it would be disposed with it
  character.mountHeadOn(character.anchors.neck);
  bodyBuild = null;
  if (checked('bodyOn') && lastHead) {
    const outfit = outfitById($<HTMLSelectElement>('outfit').value);
    const skin = skinHex();
    const atlas = paintOutfit(outfit, {
      top: $<HTMLInputElement>('colTop').value, bottom: $<HTMLInputElement>('colBottom').value,
      shoes: $<HTMLInputElement>('colShoes').value, accent: outfit.colours.accent, skin, ...skinTexture(skin), texStrength: val('texStrength'), texClothes: checked('texClothes'), skinSurf: { style: $<HTMLSelectElement>('skinSurf').value as SkinSurface, amt: val('skinSurfAmt') },
    });
    const mat = createPs1Material(pixelTexture(atlas), { resolution, snap: val('snap'), affine: val('affine'), levels: val('levels') });
    mat.name = 'body';
    bodyMats.push(mat);
    bodyBuild = buildBody({ heads: val('bodyHeads'), build: $<HTMLSelectElement>('bodyBuild').value, shoulders: $<HTMLSelectElement>('shoulders').value }, outfit, mat);
    character.setSlot('body', bodyBuild.group);
    character.mountHeadOn(bodyBuild.joints.neck); // from here the head leans, turns and sways with the body
    restPelvisY = bodyBuild.joints.pelvis.position.y;
  }
  positionCharacter();
  if (bodyBuild) {
    // remember where the lowest point of the body is at rest, so every pose can be set back down on the same floor
    bodyBuild.group.updateMatrixWorld(true);
    restMinY = new THREE.Box3().setFromObject(bodyBuild.group).min.y;
    applyWork();
  }
  if (had !== (bodyBuild !== null)) rebuildAccessories(); // long hair spreads wider over shoulders when a body is shown
  if (reframe || had !== (bodyBuild !== null)) frameCamera();
}

// ---------- poses ----------
const POSE_KEY = 'facemaker.poses.v1';
let savedPoses: Pose[] = [];
try { savedPoses = JSON.parse(localStorage.getItem(POSE_KEY) ?? '[]'); } catch { /* storage unavailable */ }
const allPoses = () => [...POSES, ...savedPoses];
/** the pose being shown: it starts as a preset and is changed by the sliders */
let work: Record<(typeof JOINT_NAMES)[number], Rot> = fullPose(POSES[0].joints);

/** Poses the body to `work`, then sets it back on the floor, so a crouch or a high kick does not float or sink. */
function applyWork() {
  if (!bodyBuild) return;
  const j = bodyBuild.joints;
  j.pelvis.position.y = restPelvisY;
  applyPose(j, work);
  bodyBuild.group.updateMatrixWorld(true);
  const lowest = new THREE.Box3().setFromObject(bodyBuild.group).min.y;
  j.pelvis.position.y = restPelvisY + (restMinY - lowest);
}

function refreshPoseMenu(select?: string) {
  const sel = $<HTMLSelectElement>('pose');
  sel.innerHTML = '';
  for (const p of POSES) sel.add(new Option(p.label, p.id));
  if (savedPoses.length) {
    const g = document.createElement('optgroup'); g.label = 'My poses';
    for (const p of savedPoses) g.append(new Option(p.label, p.id));
    sel.append(g);
  }
  sel.add(new Option('Custom (edited)', 'custom'));
  sel.value = select ?? 'stand';
  $('poseDelete').hidden = !savedPoses.some((p) => p.id === sel.value);
}

function buildPoseSliders() {
  const host = $('poseJoints');
  host.innerHTML = '';
  const axes: [string, string][] = [['bend', '-180'], ['turn', '-180'], ['tilt', '-180']];
  for (const name of JOINT_NAMES) {
    const d = document.createElement('details');
    d.innerHTML = `<summary>${JOINT_LABELS[name]}</summary>` + axes.map(([label], k) => `<label class="row">${label} <input type="range" min="-180" max="180" step="1" data-joint="${name}" data-axis="${k}" value="0" /> <span class="num" style="width:3.2em;text-align:right;color:var(--dim)">0°</span></label>`).join('');
    host.append(d);
  }
  host.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.dataset.joint) return;
    work[t.dataset.joint as keyof typeof work][Number(t.dataset.axis)] = Number(t.value);
    (t.nextElementSibling as HTMLElement).textContent = `${t.value}°`;
    $<HTMLSelectElement>('pose').value = 'custom';
    $('poseDelete').hidden = true;
    applyWork();
  });
}

function syncPoseSliders() {
  for (const el of $('poseJoints').querySelectorAll<HTMLInputElement>('input[data-joint]')) {
    const v = work[el.dataset.joint as keyof typeof work][Number(el.dataset.axis)];
    el.value = String(v);
    (el.nextElementSibling as HTMLElement).textContent = `${Math.round(v)}°`;
  }
}

function choosePose(id: string) {
  const p = allPoses().find((q) => q.id === id);
  if (p) work = fullPose(p.joints);
  syncPoseSliders();
  $('poseDelete').hidden = !savedPoses.some((q) => q.id === id);
  applyWork();
}

function rebuildAccessories() {
  for (const m of accessoryMats) { (m.uniforms.uMap.value as THREE.Texture)?.dispose(); }
  accessoryMats = [];
  character.setSlot('hair', null);
  character.setSlot('hat', null);
  if (!lastHead) return;
  const hair = hairById(currentHair());
  if (hair) {
    const mesh = new THREE.Mesh(buildHair(lastHead, hair, { wide: bodyBuild !== null, bangs: checked('bangs') }), accessoryMaterial(hairTexture(hairHex()), 'hair'));
    mesh.name = 'hair';
    character.setSlot('hair', mesh);
  }
  const hatId = $<HTMLSelectElement>('hatType').value;
  if (hatId !== 'none') {
    const geo = buildHat(lastHead, hatId);
    if (geo) {
      const mesh = new THREE.Mesh(geo, accessoryMaterial(hatTexture($<HTMLInputElement>('hatColor').value), 'hat'));
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

// ---------- paper model ----------
let paperPages: HTMLCanvasElement[] = [];

/** the triangles of a mesh as paper-model input (position and uv), optionally only those whose tag is `tag` */
function meshTris(geo: THREE.BufferGeometry, tag?: string | string[]): PieceInput['tris'] {
  const pos = geo.getAttribute('position'), uv = geo.getAttribute('uv');
  const tags = geo.userData.tags as string[] | undefined;
  const want = tag === undefined ? null : Array.isArray(tag) ? tag : [tag];
  const out: PieceInput['tris'] = [];
  for (let t = 0; t < pos.count / 3; t++) {
    if (want && tags && !want.includes(tags[t])) continue;
    const p = [0, 1, 2].map((k) => [pos.getX(t * 3 + k), pos.getY(t * 3 + k), pos.getZ(t * 3 + k)] as P3) as [P3, P3, P3];
    const q = [0, 1, 2].map((k) => [uv.getX(t * 3 + k), uv.getY(t * 3 + k)] as P2) as [P2, P2, P2];
    out.push({ p, uv: q });
  }
  return out;
}

/** Builds the paper model from what is on screen right now, so changing the face, hair or colours and printing again changes the print. */
function makePaper() {
  if (!headMesh || !texCanvas || !lastHead) { status('Nothing to print yet.'); return; }
  const widthMm = Number($<HTMLInputElement>('paperWidth').value) || 120;
  const card = $<HTMLSelectElement>('paperType').value === 'card';
  status('building the paper model…');
  setTimeout(() => {
    const headTex = texCanvas!;
    const hatch = material.uniforms.uHatch.value > 0.5, speckle = material.uniforms.uSpeckle.value > 0.5;
    const flat = { hatch, speckle, strength: material.uniforms.uTexStrength.value as number, maxU: 8 / headTex.width, minV: 1 - 4 / headTex.width };
    const g = headMesh!.geometry;
    const pieces: PieceInput[] = [
      { id: 'skull', name: 'Head', prefix: 'S', tris: meshTris(g, 'skull'), texture: headTex, attach: 'none', flat },
      { id: 'neck', name: 'Neck', prefix: 'N', tris: meshTris(g, 'neck'), texture: headTex, attach: 'top', flat },
      { id: 'nose', name: 'Nose', prefix: 'O', tris: meshTris(g, 'nose'), texture: headTex, attach: 'all', flat },
      { id: 'earL', name: 'Left ear', prefix: 'L', tris: meshTris(g, 'earL'), texture: headTex, attach: 'all', flat },
      { id: 'earR', name: 'Right ear', prefix: 'R', tris: meshTris(g, 'earR'), texture: headTex, attach: 'all', flat },
    ];
    const addShell = (slot: 'hair' | 'hat', name: string, prefix: string) => {
      const mesh = character.getSlot(slot) as THREE.Mesh | undefined;
      if (!mesh || !checked(slot === 'hair' ? 'paperHair' : 'paperHat')) return;
      const tex = (mesh.material as THREE.ShaderMaterial).uniforms.uMap.value.image as HTMLCanvasElement;
      pieces.push({ id: slot, name, prefix, tris: meshTris(mesh.geometry), texture: tex, attach: 'none' });
    };
    addShell('hair', 'Hair', 'H');
    addShell('hat', 'Hat', 'T');
    const result = buildPaperModel(pieces.filter((p) => p.tris.length), {
      scale: widthMm / lastHead!.width, tabDepth: card ? 5 : 7, maxDim: 175, bleed: 1.2,
      pageW: 215.9, pageH: 279.4, margin: 8, dpi: 300, cardstock: card,
    });
    paperPages = result.pages;
    const s = result.stats;
    $('paperInfo').innerHTML = `${s.pieces} pieces unfolded into ${s.islands} flat parts (${s.triangles} triangles, ${s.tabs} glue tabs) on ${s.pages} Letter page${s.pages > 1 ? 's' : ''}. The head is about ${(s.heightMm / 10).toFixed(1)} cm tall with the neck. Print at 100% / "actual size" and check the 50 mm bar.` +
      (result.warnings.length ? `<br><b>Note:</b> ${result.warnings.map(esc).join(' ')}` : '');
    const host = $('paperPages');
    host.innerHTML = '';
    for (const c of paperPages) { const v = document.createElement('canvas'); v.width = 560; v.height = Math.round((560 * c.height) / c.width); v.getContext('2d')!.drawImage(c, 0, 0, v.width, v.height); host.append(v); }
    $<HTMLDialogElement>('paperDialog').showModal();
    status(`paper model: ${s.islands} parts on ${s.pages} page${s.pages > 1 ? 's' : ''}`);
  }, 30);
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
  for (const b of BUILDS) $<HTMLSelectElement>('bodyBuild').add(new Option(b.label, b.id));
  for (const s of SHOULDER_STYLES) $<HTMLSelectElement>('shoulders').add(new Option(s.label, s.id));
  for (const o of OUTFITS) $<HTMLSelectElement>('outfit').add(new Option(o.label, o.id));
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
  // body controls
  const applyOutfitColours = () => {
    const c = outfitById($<HTMLSelectElement>('outfit').value).colours;
    $<HTMLInputElement>('colTop').value = c.top; $<HTMLInputElement>('colBottom').value = c.bottom; $<HTMLInputElement>('colShoes').value = c.shoes;
  };
  applyOutfitColours();
  $('bodyOn').onchange = () => rebuildBody(true);
  $('outfit').onchange = () => { applyOutfitColours(); rebuildBody(false); };
  for (const id of ['bodyBuild', 'bodyHeads', 'colTop', 'colBottom', 'colShoes', 'colSkin', 'skinAuto', 'skinWarm', 'skinHatch', 'texStrength', 'texClothes', 'skinSurf', 'skinSurfAmt', 'shoulders']) $(id).oninput = () => rebuildBody(false);
  $('shoulders').onchange = () => rebuildBody(false);
  $('skinHatch').onchange = () => { updateHeadHatch(); rebuildBody(false); };
  $('texStrength').oninput = () => { updateHeadHatch(); rebuildBody(false); };
  for (const id of ['skinSurf', 'skinSurfAmt']) $(id).addEventListener('input', () => { updateHeadHatch(); rebuildTexture(); });
  for (const id of ['wobbleOn']) $(id).oninput = applyLook;
  const syncNeedsBody = () => { $('poseNeedsBody').hidden = checked('bodyOn'); };
  syncNeedsBody();
  $('bodyOn').addEventListener('change', syncNeedsBody);
  $('poseBodyOn').onclick = () => { const b = $<HTMLInputElement>('bodyOn'); b.checked = true; b.dispatchEvent(new Event('change')); };
  buildPoseSliders();
  refreshPoseMenu('stand');
  syncPoseSliders();
  $('pose').onchange = () => { const id = $<HTMLSelectElement>('pose').value; if (id !== 'custom') choosePose(id); };
  $('poseMirror').onclick = () => { work = mirrorPose(work); syncPoseSliders(); $<HTMLSelectElement>('pose').value = 'custom'; $('poseDelete').hidden = true; applyWork(); };
  $('poseReset').onclick = () => { const id = $<HTMLSelectElement>('pose').value; choosePose(id === 'custom' ? 'stand' : id); $<HTMLSelectElement>('pose').value = id === 'custom' ? 'stand' : id; };
  $('poseSave').onclick = () => {
    const name = prompt('Name this pose:');
    if (!name?.trim()) return;
    const id = 'mine-' + Date.now().toString(36);
    savedPoses.push({ id, label: name.trim(), joints: JSON.parse(JSON.stringify(work)) });
    try { localStorage.setItem(POSE_KEY, JSON.stringify(savedPoses)); } catch { /* storage unavailable */ }
    refreshPoseMenu(id);
  };
  $('poseDelete').onclick = () => {
    const id = $<HTMLSelectElement>('pose').value;
    if (!savedPoses.some((p) => p.id === id) || !confirm('Delete this saved pose?')) return;
    savedPoses = savedPoses.filter((p) => p.id !== id);
    try { localStorage.setItem(POSE_KEY, JSON.stringify(savedPoses)); } catch { /* storage unavailable */ }
    refreshPoseMenu('stand'); choosePose('stand');
  };
  // sidebar tabs, remembering the last one
  const showTab = (name: string) => {
    document.querySelectorAll<HTMLElement>('#panels > section').forEach((s) => { s.hidden = s.dataset.panel !== name; });
    document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    try { localStorage.setItem('facemaker.tab', name); } catch { /* storage unavailable */ }
  };
  document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => { b.onclick = () => showTab(b.dataset.tab!); });
  let startTab = 'face';
  try { startTab = localStorage.getItem('facemaker.tab') ?? 'face'; } catch { /* storage unavailable */ }
  showTab(document.querySelector(`#tabs button[data-tab="${startTab}"]`) ? startTab : 'face');
  for (const id of ['backColor', 'paper', 'useFaceBase', 'useHairEars', 'hairAuto', 'bangs']) $(id).oninput = () => { rebuildTexture(); rebuildAccessories(); };
  hairSel.onchange = hatSel.onchange = () => rebuildAccessories();
  $('hatColor').oninput = rebuildAccessories;
  $('texSize').onchange = rebuildHead;
  for (const id of ['snap', 'affine', 'levels', 'renderH']) $(id).oninput = applyLook;
  $('savePng').onclick = async () => {
    renderer.render(scene, camera);
    let c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    c.getContext('2d')!.drawImage(canvas, 0, 0);
    if (checked('trimShot')) c = trimToContent(c, 3); // crop to what is drawn; the background is transparent
    const scale = Number($<HTMLSelectElement>('shotScale').value);
    if (scale > 1) {
      const big = document.createElement('canvas');
      big.width = c.width * scale; big.height = c.height * scale;
      const ctx = big.getContext('2d')!;
      ctx.imageSmoothingEnabled = false; // keep the chunky pixels crisp
      ctx.drawImage(c, 0, 0, big.width, big.height);
      c = big;
    }
    download(await canvasToBlob(c), `${checked('bodyOn') ? 'figure' : 'head'}-${doc?.seed ?? 'face'}.png`);
    status(`saved ${c.width}×${c.height} PNG`);
  };
  const stamp = () => String(doc?.seed ?? 'character');
  $('makePaper').onclick = () => makePaper();
  $('paperPdf').onclick = () => { if (paperPages.length) download(new Blob([makePdf(paperPages, 612, 792) as BlobPart], { type: 'application/pdf' }), `paper-head-${stamp()}.pdf`); };
  $('paperPng').onclick = async () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < paperPages.length; i++) files[`page-${i + 1}.png`] = new Uint8Array(await (await canvasToBlob(paperPages[i])).arrayBuffer());
    download(new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' }), `paper-head-${stamp()}-pages.zip`);
  };
  $('saveObj').onclick = async () => {
    const name = `character-${stamp()}`;
    const out = await exportObj(character.root, name, Number($<HTMLSelectElement>('objTex').value));
    const files: Record<string, Uint8Array> = { [`${name}.obj`]: new TextEncoder().encode(out.obj), [`${name}.mtl`]: new TextEncoder().encode(out.mtl) };
    for (const [path, data] of Object.entries(out.textures)) files[path] = data;
    download(new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' }), `${name}.zip`);
    status(`saved ${out.triangles} triangles with ${Object.keys(out.textures).length} textures`);
  };
  $('saveStl').onclick = () => {
    const out = exportStl(character.root, Number($<HTMLInputElement>('stlHeight').value) || 100);
    download(new Blob([out.data as BlobPart], { type: 'model/stl' }), `character-${stamp()}.stl`);
    status(`saved STL: ${out.triangles} triangles (shape only, no colour)`);
  };
  $('saveTex').onclick = async () => { if (texCanvas) download(await canvasToBlob(texCanvas), `head-texture-${doc?.seed ?? 'face'}.png`); };

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    controls.update();
    character.root.rotation.y = checked('spin') ? Math.sin(clock.getElapsedTime() * 0.7) * 0.5 : 0;
    renderer.render(scene, camera);
  });
  (window as any).__app = { renderer, scene, camera, character, controls, ready: true, exportObj, exportStl };
}
init().catch((e) => { status('init failed: ' + e); console.error(e); });
