# PS1 character reference notes

Measurements and observations taken from a set of PlayStation-era character models, used as *reference only* to set
proportions and polygon budgets for the procedural heads and bodies. No geometry or textures from those models are in this repo.

## Budget
- A whole character is about **500 to 1,200 triangles** (most 520 to 770; Fighter Maker characters about 1,200).
- Head and hair together are roughly 100 to 250 of those.
- Clothing is painted into the textures; real geometry is added only for things that change the silhouette (skirts, coat tails, hair, hats, vests).

## Body (heads tall, measured on the front view)
- About **6 to 6.5 heads tall** (range 5.4 to 6.7).
- Shoulder width: men about **2.2 head-heights**, women about **1.6**.
- Arms hang to mid-thigh; hands are blocky mittens (often gloved).
- Legs are about half the height; feet are simple wedges.
- Built from rigid segments on joints (torso, pelvis, upper and lower arms, hands, thighs, shins, feet), so poses are joint rotations.

## Heads
- Silhouette is a faceted hexagon: wide at brow and cheeks, tapering to a flat or pointed chin.
- The face is one flat painted plane (large eyes, strong simple features); nose is a small wedge, ears are small flaps.
- Skull is deep and boxy with a flat back; hair adds volume and often has a hard silhouette.
- Hair and headwear are separate shells: sharp bob with forward locks, deep curtain hair, ponytail blade, swept bangs, mohawk crest, headbands, peaked caps.

## Where this shows up in the code
- `apps/ps1-3d/src/head.ts`: head presets (ring lofts) and the nose, ears, neck.
- `apps/ps1-3d/src/shells.ts`: hair and hat shells.
- `apps/ps1-3d/src/body.ts`, `outfit.ts`, `poses.ts`: segmented body, painted outfits, joint poses.
