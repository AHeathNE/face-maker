// Serves the library packs to the apps. In dev, /packs/** comes straight from the packs folder. In a build, only packs
// marked shareable are copied into dist, so a private pack (for example one made from modern photos) never ships.
import type { Plugin, ResolvedConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { PACKS_ROOT, listPacks } from './packs.ts';
import { listInfo, publishPacks } from './publish.ts';

const TYPES: Record<string, string> = { '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.txt': 'text/plain' };

/** Set FACE_MAKER_PACKS=external when the packs are published once for several apps (see scripts/build-site.mjs). */
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
      if (config.command !== 'build' || process.env.FACE_MAKER_PACKS === 'external') return;
      const ids = await publishPacks(join(resolve(config.root, config.build.outDir), 'packs'), opts);
      this.info?.(`packs: ${ids.join(', ') || 'none'}`);
    },
  };
}
