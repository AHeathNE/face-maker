// Cuts source portraits in chunks, saving after each chunk so the apps have parts to work with right away.
// The dev server must be running on :5174 (npm run cutter).
//
//   node tools/cutter/headless.mjs [--pack historic] [--chunk 25] [--era id] [--max-chunks N]
//                                  [--only face,hair] [--force] [--dry] [--no-log] [--shots dir]
//
// Each slot (eye, brow, nose, mouth, ear, face, hair) has its own version below. A source is only re-cut for the
// slots whose version is newer than the one it was last cut with, so changing how faces are healed re-cuts the faces
// and leaves the eyes alone. Face landmarks are cached per source, so partial re-cuts skip the slow detection step.
//
//   --dry         print what would be cut, without cutting
//   --only a,b    limit the run to those slots (still only the ones that are out of date, unless --force)
//   --force       cut the chosen slots (or all) for every source that has a face, whatever the versions say
//   --no-log      leave cut-log.json alone (for experiments)
//
// Progress lives in tools/pipeline/cache/<pack>/cut-log.json. A source where no face was found is not retried;
// delete tools/pipeline/cache/<pack>/landmarks/ to make detection run again.
import puppeteer from 'puppeteer-core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bump a slot's number when that slot's cut changes enough that old parts should be redone. Only that slot is redone.
const SLOT_VERSION = { face: 6, hair: 1, eye: 1, brow: 1, nose: 1, mouth: 1, ear: 1 };
const ALL = Object.keys(SLOT_VERSION);

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const pack = opt('--pack', 'historic');
const logPath = join(here, '../pipeline/cache', pack, 'cut-log.json');
const only = opt('--only', null)?.split(',').filter(Boolean) ?? null;
const chunkSize = Number(opt('--chunk', 25));
const eraFilter = opt('--era', null);
const maxChunks = Number(opt('--max-chunks', Infinity));
const force = args.includes('--force');
const dry = args.includes('--dry');
const noLog = args.includes('--no-log');
const shotsDir = opt('--shots', null);
const base = 'http://127.0.0.1:5174';

if (only && only.some((s) => !ALL.includes(s))) throw new Error(`unknown slot in --only (use ${ALL.join(', ')})`);

let log = {};
try { log = JSON.parse(await readFile(logPath, 'utf8')); } catch { /* first run */ }
const keyOf = (e) => `${e.era}:${e.objectId}`;
// sources you removed on the review page stay removed, so there is no point cutting them
let removed = new Set();
try {
  const overrides = JSON.parse(await readFile(join(here, '../../packs', pack, 'overrides.json'), 'utf8'));
  removed = new Set(Object.entries(overrides).filter(([, v]) => v === 'remove').map(([k]) => k));
} catch { /* no overrides yet */ }

/**
 * Which slots of this source are out of date. Older log entries only have one number `v` for the whole source, which
 * counts as the version of every slot. Sources where no face was found have nothing to cut.
 */
function staleSlots(entry) {
  const want = only ?? ALL;
  if (!entry) return ALL; // never cut: the first cut is always a full one, which also finds the face
  if (entry.parts === 0) return force && !only ? ALL : []; // --force alone re-checks them; --only never tries to cut slots of a face-less source
  if (force) return want;
  return want.filter((s) => (entry.slots?.[s] ?? entry.v ?? 0) < SLOT_VERSION[s]);
}

const sources = await (await fetch(`${base}/api/sources?pack=${pack}`)).json();
const todo = sources
  .filter((e) => (!eraFilter || e.era === eraFilter) && !removed.has(keyOf(e)))
  .map((e) => ({ era: e.era, objectId: e.objectId, slots: staleSlots(log[keyOf(e)]) }))
  .filter((e) => e.slots.length);

// Group sources by the set of slots they need, so each group can be cut in one go.
const groups = new Map();
for (const e of todo) {
  const full = e.slots.length === ALL.length;
  const key = full ? '*' : e.slots.join(',');
  groups.set(key, [...(groups.get(key) ?? []), e]);
}
// Full cuts first (new sources), alternating between eras so every chunk is a mix and early chunks are useful.
function interleave(list) {
  const byEra = new Map();
  for (const e of list) byEra.set(e.era, [...(byEra.get(e.era) ?? []), e]);
  const out = [];
  for (let i = 0; [...byEra.values()].some((l) => i < l.length); i++) for (const l of byEra.values()) if (i < l.length) out.push(l[i]);
  return out;
}
const plan = [...groups.entries()].sort(([a], [b]) => (a === '*' ? -1 : b === '*' ? 1 : a.localeCompare(b)))
  .map(([key, list]) => ({ key, slots: key === '*' ? null : key.split(','), list: key === '*' ? interleave(list) : list }));

console.log(`${sources.length} sources in "${pack}"; ${todo.length} need cutting`);
for (const g of plan) console.log(`  ${g.slots ? g.slots.join('+') + ' only' : 'full cut (new sources)'}: ${g.list.length} sources`);
if (dry || !todo.length) { console.log(dry ? '(dry run: nothing cut)' : 'nothing to do'); process.exit(0); }

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: true, protocolTimeout: 0,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
page.on('pageerror', (e) => console.error('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && console.error('console', m.text().slice(0, 200)));
await page.goto(`${base}/?pack=${pack}`);
await page.waitForFunction(() => window.__cutter, { timeout: 120000 });

let chunkNo = 0, totalParts = 0;
outer: for (const g of plan) {
  const pending = [...g.list];
  await page.evaluate((slots) => window.__cutter.setOnly(slots), g.slots);
  while (pending.length) {
    if (chunkNo >= maxChunks) break outer;
    const chunk = pending.splice(0, chunkSize);
    chunkNo++;
    const keys = chunk.map(keyOf);
    const t0 = Date.now();
    await page.evaluate((keys) => {
      const set = new Set(keys);
      for (const e of window.__cutter.entries()) e.done = !set.has(`${e.meta.era}:${e.meta.objectId}`);
      document.getElementById('era').value = 'all';
      document.getElementById('status').textContent = 'working';
      document.getElementById('run').click();
    }, keys);
    await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('done'), { timeout: 0, polling: 1000 });
    if (shotsDir) {
      const cards = await page.$$('.card:not(.noface)');
      for (let i = 0; i < Math.min(cards.length, 5); i++) await cards[i].screenshot({ path: join(shotsDir, `chunk${chunkNo}-card${i}.png`) });
    }
    const result = await page.evaluate(async (keys) => {
      const set = new Set(keys);
      const mine = window.__cutter.entries().filter((e) => set.has(`${e.meta.era}:${e.meta.objectId}`));
      // Anything unlabeled is saved as a provisional "andro" with genderSource "default" so it can be found and fixed later.
      for (const e of mine) if (e.gender === 'unset') { e.gender = 'andro'; e.genderSource = 'default'; }
      const summary = mine.map((e) => ({ key: `${e.meta.era}:${e.meta.objectId}`, parts: e.parts.length, how: e.how ?? null }));
      await window.__cutter.save();
      const status = document.getElementById('status').textContent;
      window.__cutter.reset();
      return { summary, status };
    }, keys);

    for (const s of result.summary) {
      const prev = log[s.key] ?? {};
      const cutSlots = g.slots ?? ALL;
      const slots = { ...(prev.slots ?? Object.fromEntries(ALL.map((x) => [x, prev.v ?? 0]))) };
      if (s.parts > 0 || !g.slots) for (const x of cutSlots) slots[x] = SLOT_VERSION[x];
      log[s.key] = { parts: g.slots ? (s.parts > 0 ? prev.parts ?? s.parts : prev.parts ?? 0) : s.parts, how: s.how ?? prev.how ?? null, slots };
    }
    if (!noLog) {
      await mkdir(dirname(logPath), { recursive: true });
      await writeFile(logPath, JSON.stringify(log, null, 1));
    }
    totalParts += result.summary.reduce((n, s) => n + s.parts, 0);
    const left = pending.length;
    console.log(`chunk ${chunkNo} [${g.slots ? g.slots.join('+') : 'full'}]: ${result.summary.filter((s) => s.parts).length}/${chunk.length} sources · ${result.status} · ${Math.round((Date.now() - t0) / 1000)}s · ${left} left in this group`);
  }
}
console.log(`done: ${totalParts} parts saved in ${chunkNo} chunk(s)`);
await browser.close();
