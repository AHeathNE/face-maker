// Downloads candidate portraits (public domain / CC0 only) into tools/pipeline/cache/sources/<era>/.
// Usage: node tools/pipeline/fetch.ts [eraId] [--pack historic] [--provider met|loc|wikimedia]
// What to fetch and which licences to accept comes from packs/<pack>/pack.json.
// Every saved image gets a sidecar <id>.json with provenance + license; ids are unique across providers.
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPack } from '../../packages/assets/packs.ts';

type Gender = 'masc' | 'femme' | 'andro';
interface Candidate {
  provider: string; objectId: string; url: string; title: string; artist: string; date: string;
  medium: string; credit: string; license: string; genderGuess: Gender | null; imageUrl: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const packIdx = argv.indexOf('--pack');
const packId = packIdx >= 0 ? argv[packIdx + 1] : 'historic';
const pack = await readPack(packId);
const cacheRoot = join(here, 'cache', packId, 'sources');
// licence names this pack accepts (and refuses), matched as prefixes with spaces and dashes interchangeable
const prefixRe = (names: string[]) => new RegExp('^(' + names.map((l) => l.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[ -]/g, '[ -]?')).join('|') + ')', 'i');
const LICENSE_OK = prefixRe(pack.licenses);
const LICENSE_BAD = pack.rejectLicenses?.length ? prefixRe(pack.rejectLicenses) : null;
// Wikimedia asks automated clients to identify themselves with a way to reach the operator; the repository serves as that.
const UA = 'FaceMakerPipeline/0.1 (+https://github.com/AHeathNE/face-maker; personal art project, open-licensed collage parts)';
const MAX_ORIGINAL_BYTES = 12 * 1024 * 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const exists = (p: string) => access(p).then(() => true, () => false);
const stripHtml = (s = '') => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// CDNs answer 403/429 when we go too fast, so back off and retry.
async function politeFetch(url: string, tries = 5): Promise<Response> {
  for (let i = 0; i < tries; i++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(90_000) });
    } catch (e) {
      console.warn(`  network error on ${url.slice(0, 90)} (${(e as Error).message}); retrying`);
      await sleep(5_000 * (i + 1));
      continue;
    }
    if (res.status !== 403 && res.status !== 429) return res;
    const wait = 20_000 * (i + 1);
    console.warn(`  ${res.status} on ${url.slice(0, 90)}; waiting ${wait / 1000}s`);
    await sleep(wait);
  }
  return fetch(url, { headers: { 'user-agent': UA } });
}

async function getJson(url: string) {
  const res = await politeFetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function guessGender(text: string): Gender | null {
  const t = text.toLowerCase();
  const f = /\b(women|woman|lady|girl|queen|princess|duchess|countess|mrs|madame|miss|empress|actress)\b/.test(t);
  const m = /\b(men|man|gentleman|boy|king|prince|duke|count|sir|mr|emperor|general|president)\b/.test(t);
  if (f && !m) return 'femme';
  if (m && !f) return 'masc';
  return null;
}

async function saveCandidate(era: string, c: Candidate, fallbackUrl?: string): Promise<boolean> {
  const dir = join(cacheRoot, era);
  await mkdir(dir, { recursive: true });
  const jsonPath = join(dir, `${c.objectId}.json`);
  if (await exists(jsonPath)) return true;
  let res = await politeFetch(c.imageUrl);
  const len = Number(res.headers.get('content-length') ?? 0);
  if ((!res.ok || len > MAX_ORIGINAL_BYTES) && fallbackUrl) res = await politeFetch(fallbackUrl);
  if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/jpeg')) return false;
  let body: Buffer;
  try { body = Buffer.from(await res.arrayBuffer()); } catch (e) { console.warn(`  download dropped for ${c.objectId}; skipping`); return false; }
  await writeFile(join(dir, `${c.objectId}.jpg`), body);
  const { imageUrl: _omit, ...meta } = c;
  await writeFile(jsonPath, JSON.stringify({ ...meta, era }, null, 2));
  return true;
}

// ---------- Met (CC0 Open Access) ----------
const MET_SEARCH = 'https://collectionapi.metmuseum.org/public/collection/v1.1'; // search only
const MET_V1 = 'https://collectionapi.metmuseum.org/public/collection/v1'; // object lookup

async function fetchMet(era: string, src: any) {
  const params = new URLSearchParams({ isPublicDomain: 'true', hasImages: 'true', limit: String(src.limit * 3), offset: '0' });
  for (const [k, v] of Object.entries(src.query)) params.set(k, String(v));
  const search = await getJson(`${MET_SEARCH}/search?${params}`);
  const ids: number[] = search.objectIDs ?? [];
  console.log(`[${era}/met] ${search.total} matches, taking up to ${src.limit}`);
  let saved = 0;
  for (const id of ids) {
    if (saved >= src.limit) break;
    const objectId = String(id);
    if (await exists(join(cacheRoot, era, `${objectId}.json`))) { saved++; continue; }
    await sleep(500);
    let obj;
    try { obj = await getJson(`${MET_V1}/objects/${id}`); } catch (e) { console.warn(String(e)); continue; }
    if (!obj.isPublicDomain || !obj.primaryImageSmall) continue;
    const ok = await saveCandidate(era, {
      provider: 'met', objectId, url: obj.objectURL, title: obj.title, artist: obj.artistDisplayName || 'Unknown',
      date: obj.objectDate, medium: obj.medium, credit: obj.creditLine, license: 'CC0',
      genderGuess: guessGender(`${(obj.tags ?? []).map((t: any) => t.term).join(' ')} ${obj.title}`),
      imageUrl: obj.primaryImage || obj.primaryImageSmall,
    }, obj.primaryImageSmall);
    if (ok) { saved++; console.log(`  ${saved}/${src.limit}  met ${id}  ${obj.title}`); }
  }
}

// ---------- Library of Congress ----------
async function fetchLoc(era: string, src: any) {
  let saved = 0, page = 1;
  console.log(`[${era}/loc] up to ${src.limit}`);
  while (saved < src.limit) {
    const params = new URLSearchParams({ fo: 'json', c: '50', sp: String(page), ...src.query });
    const search = await getJson(`https://www.loc.gov/photos/?${params}`);
    const results: any[] = search.results ?? [];
    if (!results.length) break;
    for (const r of results) {
      if (saved >= src.limit) break;
      const lccn = String(r.url ?? '').match(/\/item\/([^/]+)\//)?.[1];
      if (!lccn || !r.online_format?.includes('image')) continue;
      const objectId = `loc-${lccn}`;
      if (await exists(join(cacheRoot, era, `${objectId}.json`))) { saved++; continue; }
      await sleep(1500);
      let item;
      try { item = await getJson(`https://www.loc.gov/item/${lccn}/?fo=json`); } catch (e) { console.warn(String(e)); continue; }
      const advisory = String(item.item?.rights_advisory ?? item.item?.rights_information ?? '');
      if (!/no known restrictions|public domain/i.test(advisory)) continue;
      // largest JPEG among the item's files
      const jpgs = (item.resources ?? []).flatMap((res: any) => (res.files ?? []).flat())
        .filter((f: any) => f.mimetype === 'image/jpeg' && f.url);
      jpgs.sort((a: any, b: any) => (b.width * b.height || b.size) - (a.width * a.height || a.size));
      const best = jpgs.find((f: any) => (f.size ?? 0) <= MAX_ORIGINAL_BYTES) ?? jpgs.at(-1);
      if (!best || (best.width && best.width < 500)) continue;
      const title = stripHtml(String(item.item?.title ?? r.title ?? ''));
      const subjects = (item.item?.subject_headings ?? item.item?.subject ?? []).join(' ');
      const ok = await saveCandidate(era, {
        provider: 'loc', objectId, url: `https://www.loc.gov/item/${lccn}/`, title,
        artist: stripHtml(String((item.item?.contributor_names ?? item.item?.contributor ?? ['Unknown'])[0] ?? 'Unknown')),
        date: String(item.item?.date ?? r.date ?? ''), medium: String((item.item?.medium ?? [''])[0] ?? ''),
        credit: 'Library of Congress, Prints & Photographs Division — ' + advisory.trim(), license: 'PD',
        genderGuess: guessGender(`${title} ${subjects}`), imageUrl: best.url,
      });
      if (ok) { saved++; console.log(`  ${saved}/${src.limit}  loc ${lccn}  ${title.slice(0, 60)}`); }
    }
    page++;
  }
}

// ---------- Wikimedia Commons ----------
const WM_API = 'https://commons.wikimedia.org/w/api.php';

async function wmMembers(category: string, type: 'file' | 'subcat'): Promise<any[]> {
  const out: any[] = [];
  let cont = '';
  do {
    const p = new URLSearchParams({
      action: 'query', format: 'json', generator: 'categorymembers', gcmtitle: `Category:${category}`,
      gcmtype: type, gcmlimit: '50', prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '2400',
      iiextmetadatafilter: 'LicenseShortName|Artist|ObjectName|DateTimeOriginal|Credit',
    });
    if (cont) p.set('gcmcontinue', cont);
    const data = await getJson(`${WM_API}?${p}`);
    out.push(...Object.values<any>(data.query?.pages ?? {}));
    cont = data.continue?.gcmcontinue ?? '';
    await sleep(300);
    if (out.length > 400) break;
  } while (cont);
  return out;
}

async function wmSubcats(category: string): Promise<string[]> {
  const p = new URLSearchParams({ action: 'query', format: 'json', list: 'categorymembers', cmtitle: `Category:${category}`, cmtype: 'subcat', cmlimit: '60' });
  const data = await getJson(`${WM_API}?${p}`);
  return (data.query?.categorymembers ?? []).map((m: any) => m.title.replace(/^Category:/, ''));
}

async function fetchWikimedia(era: string, src: any) {
  for (const cat of src.categories) {
    console.log(`[${era}/wikimedia] ${cat.name} up to ${cat.limit}`);
    let saved = 0;
    const queue = [cat.name];
    const seenCats = new Set<string>();
    while (queue.length && saved < cat.limit) {
      const name = queue.shift()!;
      if (seenCats.has(name)) continue;
      seenCats.add(name);
      if (name === cat.name) queue.push(...(await wmSubcats(name)).slice(0, 40));
      for (const page of await wmMembers(name, 'file')) {
        if (saved >= cat.limit) break;
        const ii = page.imageinfo?.[0];
        if (!ii || ii.mime !== 'image/jpeg' || ii.width < 600 || ii.height < 600) continue;
        const md = ii.extmetadata ?? {};
        const license = stripHtml(md.LicenseShortName?.value);
        if (!LICENSE_OK.test(license) || LICENSE_BAD?.test(license)) continue; // anything this pack does not list is out
        const title = stripHtml(md.ObjectName?.value) || String(page.title).replace(/^File:/, '').replace(/\.jpe?g$/i, '');
        const ok = await saveCandidate(era, {
          provider: 'wikimedia', objectId: `wm-${page.pageid}`, url: ii.descriptionurl, title,
          artist: stripHtml(md.Artist?.value) || 'Unknown', date: stripHtml(md.DateTimeOriginal?.value),
          medium: 'engraving', credit: `Wikimedia Commons — ${license}. ${stripHtml(md.Credit?.value).slice(0, 160)}`,
          license: /cc0|zero/i.test(license) ? 'CC0' : /^(public domain|pd)/i.test(license) ? 'PD' : license, genderGuess: cat.gender ?? guessGender(title),
          imageUrl: ii.thumburl || ii.url,
        });
        if (ok) { saved++; console.log(`  ${saved}/${cat.limit}  wm ${page.pageid}  ${title.slice(0, 60)}`); }
        await sleep(Number(src.delayMs ?? 400)); // set delayMs on the source in pack.json to go gentler
      }
    }
  }
}

const args = argv;
const provIdx = args.indexOf('--provider');
const providerFilter = provIdx >= 0 ? args[provIdx + 1] : null;
const eraFilter = args.find((a, i) => !a.startsWith('--') && (provIdx < 0 || i !== provIdx + 1) && (packIdx < 0 || i !== packIdx + 1));
const eras = pack.eras;
const handlers: Record<string, (era: string, src: any) => Promise<void>> = { met: fetchMet, loc: fetchLoc, wikimedia: fetchWikimedia };
for (const era of eras) {
  if (eraFilter && era.id !== eraFilter) continue;
  for (const src of era.sources) {
    if (providerFilter && src.provider !== providerFilter) continue;
    try { await handlers[src.provider](era.id, src); } catch (e) { console.error(`[${era.id}/${src.provider}] failed:`, e); }
  }
}
