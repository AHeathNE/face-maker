# Face Maker

Collage-style face maker built from open-licensed portrait parts. Two browser apps share one library system.

```
packages/face-core   face document format, seeded randomizer, canvas renderer, part loader, pack loader
packages/assets      pack tooling: node helpers (packs.ts) and the Vite plugin that serves packs
packs/<id>/          a library pack: pack.json, manifest.json, overrides.json, parts/**
tools/pipeline       fetch.ts: downloads source portraits for a pack (Met, Library of Congress, Wikimedia)
tools/cutter         MediaPipe landmark auto-cutter + review UI; headless.mjs runs it in Chrome
apps/collage-2d      app 1: edit / randomize / batch-export transparent PNG faces
apps/ps1-3d          app 2: the same faces as a PS1-style textured 3D head, with hair and hats
```

## Library packs

A pack is a self-contained library. Apps can use one or several at once (checkboxes at the top of "Feature pool",
or `?pack=historic,modern`), and swap them freely.

| file | what it is |
| --- | --- |
| `pack.json` | name, `shareable`, accepted licences (`licenses`, `rejectLicenses`), and the sources to fetch from, grouped into eras |
| `manifest.json` | the cut parts (written by the cutter) |
| `overrides.json` | your hand decisions (gender, angle, removed sources); they survive re-cutting |
| `parts/**` | the part PNGs |

- **Private packs.** `"shareable": false` keeps a pack out of public builds (`vite build` copies only shareable packs into `dist/packs`)
  and it is listed in `.gitignore`. Add any private pack's folder there too.
- **Era ids must be unique across packs**, so parts from several packs can be mixed in one face.
- **Licences.** Only sources whose licence starts with one of `licenses` are fetched, minus anything starting with
  `rejectLicenses` (e.g. accept `cc by` but refuse `cc by-sa`). Each part keeps its source, licence and credit; the credits dialog lists them.

### Add a pack
1. Make `packs/<id>/pack.json` (copy `packs/modern/pack.json`) and put `{ "version": 1, "parts": [] }` in `manifest.json`.
2. `node tools/pipeline/fetch.ts --pack <id>` to download source portraits (slow; the sites rate-limit).
3. `node tools/cutter/headless.mjs --pack <id>` to cut them (needs the cutter server running).
4. `http://127.0.0.1:5174/review.html?pack=<id>` to check genders and angles.

## Run

```
npm install
npm run cutter           # cutter + review server on :5174  (?pack=<id> selects a pack, default historic)
npm run cut              # headless cut in chunks of 25, saving after each (resumable)
                         #   --pack id  --chunk N  --era id  --max-chunks N
                         #   --dry          show what is out of date, cut nothing
                         #   --only a,b     limit to those slots   --force  redo them for every source with a face
npm run collage          # http://127.0.0.1:5175
npm run ps1              # http://127.0.0.1:5176
```

**Re-cutting only what changed.** Each slot (eye, brow, nose, mouth, ear, face, hair) has its own version in
`SLOT_VERSION` at the top of `tools/cutter/headless.mjs`. When you change how one slot is cut, bump just that number
and run `npm run cut`: every source is re-cut for that slot only, and the other parts are left alone. Sources where no
face was found are not retried. Face landmarks are remembered per source in `tools/pipeline/cache/<pack>/landmarks/`
(including "no face found"), so a partial re-cut skips the slow detection step; delete that folder to detect again.

## 3D app: where the body goes
`apps/ps1-3d/src/character.ts` defines a `Character` with anchors (`neck`, hands) and equipment slots
(`head`, `hair`, `hat`, `body`, `torso`, `legs`, `feet`, `hands`). The head, hair and hat are filled today.
Bodies, clothes and poses plug in there without changes to the head or face code.
