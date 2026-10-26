// Serves the library packs to the apps. In dev, /packs/** comes straight from the packs folder. In a build, only packs
// marked shareable are copied into dist, so a private pack (for example one made from modern photos) never ships.
import type { Plugin, ResolvedConfig } from 'vite';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { PACKS_ROOT, listPacks, packDir, publicInfo, type PackConfig } from './packs.ts';

async function listInfo(packs: PackConfig[]) {
  return Promise.all(packs.map(async (p) => {
    let parts = 0;
    try { parts = JSON.parse(await readFile(join(packDir(p.id), 'manifest.json'), 'utf8')).parts.length; } catch { /* no manifest yet */ }
    return { ...publicInfo(p), parts };
  }));
}

const TYPES: Record<string, string> = { '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.txt': 'text/plain' };

export function packsPlugin(opts: { includePrivate?: boolean } = {}): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'face-maker-packs',
    configResolved(c) { config = c; },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://x');
        if (!url.pathname.startsWith('/packs/')) return next();
        try {
          if (url.pathname === '/packs/index.json') {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(await listInfo(await listPacks())));
            return;
          }
          const file = normalize(join(PACKS_ROOT, decodeURIComponent(url.pathname.slice('/packs/'.length))));
          if (!file.startsWith(PACKS_ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; res.end(); return; }
          res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
          createReadStream(file).pipe(res);
        } catch (e) { res.statusCode = 500; res.end(String(e)); }
      });
    },
    async closeBundle() {
      if (config.command !== 'build') return;
      const out = join(resolve(config.root, config.build.outDir), 'packs');
      const packs = (await listPacks()).filter((p) => p.shareable || opts.includePrivate);
      await mkdir(out, { recursive: true });
      for (const p of packs) {
        await cp(packDir(p.id), join(out, p.id), { recursive: true });
        // the source config (where images were fetched from) is not needed in the published copy
        const info = JSON.parse(await readFile(join(out, p.id, 'pack.json'), 'utf8'));
        for (const era of info.eras ?? []) delete era.sources;
        await writeFile(join(out, p.id, 'pack.json'), JSON.stringify(info, null, 2));
      }
      await writeFile(join(out, 'index.json'), JSON.stringify(await listInfo(packs), null, 2));
      this.info?.(`packs: ${packs.map((p) => p.id).join(', ') || 'none'}`);
    },
  };
}
