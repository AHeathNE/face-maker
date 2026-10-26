import { defineConfig, type Plugin } from 'vite';
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPacks, packDir } from '../../packages/assets/packs.ts';

const here = dirname(fileURLToPath(import.meta.url));
const cacheRoot = join(here, '../pipeline/cache');

// Every endpoint takes ?pack=<id> (default "historic"): source portraits come from tools/pipeline/cache/<pack>/,
// finished parts go into packs/<pack>/.
const packOf = (url: URL) => {
  const id = url.searchParams.get('pack') ?? 'historic';
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('bad pack id');
  return id;
};
const manifestPath = (pack: string) => join(packDir(pack), 'manifest.json');
const overridesPath = (pack: string) => join(packDir(pack), 'overrides.json');

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}
const readManifest = (pack: string) => readJson<any>(manifestPath(pack), { version: 1, parts: [] });
const readOverrides = (pack: string) => readJson<Record<string, string>>(overridesPath(pack), {});

function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Cut saves and review edits both rewrite manifest.json; run them one at a time so neither loses the other's changes.
let queue: Promise<unknown> = Promise.resolve();
const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

const json = (res: any, body: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
const sendFile = (res: any, file: string, type: string) => {
  if (!existsSync(file)) { res.statusCode = 404; res.end(); return; }
  res.setHeader('content-type', type);
  createReadStream(file).pipe(res);
};
/** join under a root, refusing anything that escapes it */
const under = (root: string, rel: string) => { const p = normalize(join(root, decodeURIComponent(rel))); return p.startsWith(root) ? p : null; };

function pipelineApi(): Plugin {
  return {
    name: 'face-maker-pipeline-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://x');
        try {
          if (url.pathname === '/api/packs') return json(res, (await listPacks()).map((p) => ({ id: p.id, label: p.label, shareable: p.shareable })));

          if (url.pathname === '/api/sources') {
            const pack = packOf(url), src = join(cacheRoot, pack, 'sources'), lmRoot = join(cacheRoot, pack, 'landmarks');
            const out: any[] = [];
            for (const era of existsSync(src) ? await readdir(src) : []) {
              for (const f of (await readdir(join(src, era))).filter((f) => f.endsWith('.json'))) {
                const meta = JSON.parse(await readFile(join(src, era, f), 'utf8'));
                const id = f.replace('.json', '');
                out.push({ ...meta, pack, image: `/sources/${pack}/${era}/${id}.jpg`, landmarks: await readJson(join(lmRoot, era, f), null) });
              }
            }
            return json(res, out);
          }
          if (url.pathname.startsWith('/sources/')) {
            const p = under(join(cacheRoot), url.pathname.slice('/sources/'.length).replace(/^([^/]+)\//, '$1/sources/'));
            return p ? sendFile(res, p, 'image/jpeg') : void (res.statusCode = 404, res.end());
          }
          if (url.pathname === '/api/landmarks' && req.method === 'POST') {
            const { pack, era, objectId, data } = JSON.parse(await readBody(req));
            if (!/^[a-z0-9][a-z0-9-]*$/.test(pack) || /[\\/]/.test(era + objectId)) { res.statusCode = 400; res.end('bad id'); return; }
            const dir = join(cacheRoot, pack, 'landmarks', era);
            await mkdir(dir, { recursive: true });
            await writeFile(join(dir, `${objectId}.json`), JSON.stringify(data));
            return json(res, { ok: true });
          }
          if (url.pathname === '/api/manifest') return json(res, await readManifest(packOf(url)));

          if (url.pathname === '/api/relabel' && req.method === 'POST') {
            const { pack, era, objectId, gender, view } = JSON.parse(await readBody(req));
            if (view !== undefined && !['front', 'three-quarter', 'profile'].includes(view)) { res.statusCode = 400; res.end('bad view'); return; }
            if (view === undefined && !['masc', 'femme', 'andro', 'remove'].includes(gender)) { res.statusCode = 400; res.end('bad gender'); return; }
            const out = await exclusive(async () => {
              const overrides = await readOverrides(pack);
              const manifest = await readManifest(pack);
              const mine = (p: any) => p.era === era && p.source.objectId === objectId;
              if (view !== undefined) {
                overrides[`view:${era}:${objectId}`] = view;
                for (const p of manifest.parts.filter(mine)) p.view = view;
              } else {
                overrides[`${era}:${objectId}`] = gender;
                if (gender === 'remove') {
                  for (const p of manifest.parts.filter(mine)) await rm(join(packDir(pack), 'parts', p.file), { force: true });
                  manifest.parts = manifest.parts.filter((p: any) => !mine(p));
                } else {
                  for (const p of manifest.parts.filter(mine)) { p.gender = gender; p.genderSource = 'manual'; }
                }
              }
              await writeFile(overridesPath(pack), JSON.stringify(overrides, null, 2));
              await writeFile(manifestPath(pack), JSON.stringify(manifest, null, 2));
              return { parts: manifest.parts.length };
            });
            return json(res, out);
          }

          if (url.pathname === '/api/save' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req));
            const pack: string = body.pack;
            const only: string[] | undefined = body.slots; // re-cutting just these slots keeps the rest of each source's parts
            const out = await exclusive(async () => {
              const overrides = await readOverrides(pack);
              const parts = body.parts
                .filter((p: any) => overrides[`${p.era}:${p.source.objectId}`] !== 'remove')
                .map((p: any) => {
                  const o = overrides[`${p.era}:${p.source.objectId}`], v = overrides[`view:${p.era}:${p.source.objectId}`];
                  return { ...p, ...(o ? { gender: o, genderSource: 'manual' } : {}), ...(v ? { view: v } : {}) };
                });
              const manifest = await readManifest(pack);
              const replaced = new Set<string>(body.sources.map((s: any) => `${s.era}:${s.objectId}`));
              const stale = (p: any) => replaced.has(`${p.era}:${p.source.objectId}`) && (!only || only.includes(p.slot));
              for (const p of manifest.parts.filter(stale)) await rm(join(packDir(pack), 'parts', p.file), { force: true });
              manifest.parts = manifest.parts.filter((p: any) => !stale(p));
              for (const part of parts) {
                const { png, ...entry } = part;
                const abs = join(packDir(pack), 'parts', entry.file);
                await mkdir(dirname(abs), { recursive: true });
                await writeFile(abs, Buffer.from(png, 'base64'));
                manifest.parts.push(entry);
              }
              manifest.parts.sort((a: any, b: any) => a.id.localeCompare(b.id));
              await writeFile(manifestPath(pack), JSON.stringify(manifest, null, 2));
              return { saved: parts.length, total: manifest.parts.length };
            });
            return json(res, out);
          }
          if (url.pathname.startsWith('/assets/')) {
            // /assets/<pack>/<file>: a finished part, for the review page
            const m = url.pathname.slice('/assets/'.length).match(/^([a-z0-9-]+)\/(.+)$/);
            const p = m && under(join(packDir(m[1]), 'parts'), m[2]);
            return p ? sendFile(res, p, 'image/png') : void (res.statusCode = 404, res.end());
          }
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [pipelineApi()],
  server: { fs: { allow: ['../..'] } },
});
