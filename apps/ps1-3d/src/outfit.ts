import { ATLAS_CELLS, cellAt, type Cell } from './loft.ts';

/** Where each body part lives in the 4x4 atlas of 32px cells. */
export const CELL = {
  torso: cellAt(0, 0), pelvis: cellAt(1, 0), upperArm: cellAt(2, 0), foreArm: cellAt(3, 0),
  hand: cellAt(0, 1), thigh: cellAt(1, 1), shin: cellAt(2, 1), foot: cellAt(3, 1),
  skirt: cellAt(0, 2),
} as const;

import { skinNoise, type SkinSurface } from './skinSurface.ts';

export type TopKind = 'tee' | 'vtee' | 'tank' | 'tube' | 'long' | 'jacket' | 'dress' | 'bare';
export type BottomKind = 'jeans' | 'cargo' | 'shorts' | 'skirt' | 'trousers';

export interface Outfit {
  id: string;
  label: string;
  top: TopKind;
  bottom: BottomKind;
  boots: boolean;
  gloves: boolean;
  /** extra geometry that goes with the clothes */
  skirt?: 'short' | 'long';
  /** suggested colours; the user can change them */
  colours: { top: string; bottom: string; shoes: string; accent: string };
}

export const OUTFITS: Outfit[] = [
  { id: 'casual', label: 'T-shirt & jeans', top: 'tee', bottom: 'jeans', boots: false, gloves: false, colours: { top: '#b84a4a', bottom: '#3c5a86', shoes: '#e8e4da', accent: '#2a2a30' } },
  { id: 'field', label: 'Jacket & cargo', top: 'jacket', bottom: 'cargo', boots: true, gloves: true, colours: { top: '#3d4a36', bottom: '#4c4a3a', shoes: '#2a2622', accent: '#1c1c1e' } },
  { id: 'vneck', label: 'V-neck tee & jeans', top: 'vtee', bottom: 'jeans', boots: false, gloves: false, colours: { top: '#4a7a6a', bottom: '#3c5a86', shoes: '#e8e4da', accent: '#2a2a30' } },
  { id: 'tank', label: 'Tank top & shorts', top: 'tank', bottom: 'shorts', boots: false, gloves: false, colours: { top: '#e8e4da', bottom: '#2f3138', shoes: '#c64a3a', accent: '#8a8a90' } },
  { id: 'tube', label: 'Tube top & shorts', top: 'tube', bottom: 'shorts', boots: false, gloves: false, colours: { top: '#c64a6a', bottom: '#2f3138', shoes: '#e8e4da', accent: '#8a8a90' } },
  { id: 'dress', label: 'Dress & boots', top: 'dress', bottom: 'skirt', boots: true, gloves: false, skirt: 'short', colours: { top: '#5b3a78', bottom: '#5b3a78', shoes: '#4a3022', accent: '#d9c9a8' } },
  { id: 'coat', label: 'Long coat', top: 'long', bottom: 'trousers', boots: true, gloves: true, skirt: 'long', colours: { top: '#6a4b32', bottom: '#2b2d33', shoes: '#1c1c1e', accent: '#c9a86a' } },
  { id: 'bare', label: 'Shirtless', top: 'bare', bottom: 'trousers', boots: true, gloves: false, colours: { top: '#b08a6a', bottom: '#3d4046', shoes: '#26262a', accent: '#1c1c1e' } },
];
export const outfitById = (id: string) => OUTFITS.find((o) => o.id === id) ?? OUTFITS[0];

export interface OutfitColours {
  top: string; bottom: string; shoes: string; accent: string; skin: string;
  /** fine diagonal engraving lines */
  hatch?: boolean;
  /** stipple: scattered dark dots with a few light flecks, like a stippled engraving */
  speckle?: boolean;
  /** 0.4..1.6, how strong the line and dot textures are */
  texStrength?: number;
  /** also texture the clothes, not just bare skin */
  texClothes?: boolean;
  /** the surface of bare skin: soft mottling, grain or freckles */
  skinSurf?: { style: SkinSurface; amt: number };
}

const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Paints the whole outfit into a 128x128 atlas, a few flat colours with seams, belts, cuffs and grain, the way PS1 clothing
 * was done. Each part samples its own cell; a cell is 32x32 with u running around the part (middle = front) and the top of
 * the cell being the top of the part.
 */
export function paintOutfit(outfit: Outfit, colours: OutfitColours): HTMLCanvasElement {
  const size = 32 * ATLAS_CELLS;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);

  const skin = rgb(colours.skin), top = rgb(colours.top), bottom = rgb(colours.bottom), shoes = rgb(colours.shoes), accent = rgb(colours.accent);
  const dark = (c: number[], f: number): [number, number, number] => [c[0] * f, c[1] * f, c[2] * f];

  /** paint one cell with fn(fx, fy) -> colour, where fx runs around (0.5 = front) and fy runs 0 (top) .. 1 (bottom) */
  const paint = (cell: Cell, fn: (fx: number, fy: number) => number[]) => {
    const x0 = Math.round(cell.u0 * size - 0.5 / 1), y0 = Math.round((1 - cell.v1) * size);
    const cx = Math.floor((cell.u0 + 0.0001) * ATLAS_CELLS) * 32, cy = Math.floor((1 - cell.v1) * ATLAS_CELLS + 0.0001) * 32;
    void x0; void y0;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const fx = (x + 0.5) / 32, fy = (y + 0.5) / 32;
        const picked = fn(fx, fy);
        let [r, g, b] = picked;
        if (picked === skin && colours.skinSurf && colours.skinSurf.style !== 'none') {
          const n = skinNoise(colours.skinSurf.style, colours.skinSurf.amt, x + cx, y + cy, 11);
          r = r * n.f + n.warm * 14; g *= n.f; b = b * n.f - n.warm * 8;
        }
        const textured = picked === skin || colours.texClothes;
        const s = colours.texStrength ?? 1;
        if (textured && colours.hatch) {
          // one direction of engraving lines (a second direction read as plaid), a little darker toward the sides of each part
          const shade = Math.abs(fx - 0.5) * 2;
          if ((x + y) % 3 === 0) { const f = 1 - (0.2 + shade * 0.1) * s; r *= f; g *= f; b *= f; }
        }
        if (textured && colours.speckle) {
          const h = hash(x * 57 + y * 131 + cx * 3 + cy * 5);
          if (h > 0.84) { const f = 1 - 0.34 * s; r *= f; g *= f; b *= f; }          // dark dots
          else if (h < 0.035) { const f = 1 + 0.12 * s; r *= f; g *= f; b *= f; }  // a few light flecks
        }
        const grain = 0.93 + hash(x * 31 + y * 17 + cx + cy * 3) * 0.14;
        // soft shading: the sides of every part are a little darker than the front, like cheap vertex lighting baked in
        const side = 1 - Math.abs(fx - 0.5) * 0.28;
        r *= grain * side; g *= grain * side; b *= grain * side;
        const o = ((cy + y) * size + (cx + x)) * 4;
        img.data[o] = Math.min(255, r); img.data[o + 1] = Math.min(255, g); img.data[o + 2] = Math.min(255, b); img.data[o + 3] = 255;
      }
    }
  };
  const seam = (fx: number) => Math.abs(fx - 0.25) < 0.025 || Math.abs(fx - 0.75) < 0.025;
  const front = (fx: number, w: number) => Math.abs(fx - 0.5) < w;

  // torso
  paint(CELL.torso, (fx, fy) => {
    if (outfit.top === 'bare') {
      let c = skin as number[];
      if (front(fx, 0.012) && fy > 0.18) c = dark(skin, 0.75);                       // sternum line
      if (front(fx, 0.2) && (Math.abs(fy - 0.45) < 0.02 || Math.abs(fy - 0.62) < 0.02 || Math.abs(fy - 0.78) < 0.02)) c = dark(skin, 0.82); // abs
      if (fy < 0.3 && Math.abs(fy - 0.28) < 0.03 && !front(fx, 0.02)) c = dark(skin, 0.85); // chest
      return c;
    }
    // fx runs around the torso: 0.5 is the middle of the front, 0 / 1 the middle of the back. `o` is the distance from the middle
    // of whichever side faces us, so the front and back get matching necklines and straps.
    const o = fx > 0.25 && fx < 0.75 ? Math.abs(fx - 0.5) : Math.min(fx, 1 - fx);
    if (outfit.top === 'vtee' && fx > 0.25 && fx < 0.75 && fy < 0.16 && o < 0.13 * (1 - fy / 0.16)) return skin; // V-neck
    if (outfit.top === 'tube' && fy < 0.2) return skin;                                                            // strapless: shoulders bare
    if (outfit.top === 'tank') {
      // u runs by facet, not by distance: the flat front facet is |o| < 0.06, the next one out is 0.06 to 0.19, so straps at
      // 0.045 to 0.1 sit beside the neck. The neckline dips lower in the middle; outside the straps the shoulders are bare.
      const body = 0.2 + Math.max(0, 0.045 - o) * 3;
      const strap = o > 0.045 && o < 0.1;
      if (fy < body && !strap) return skin;
    }
    let c: number[] = top;
    if (seam(fx)) c = dark(top, 0.8);
    if (outfit.top === 'jacket' || outfit.top === 'long') {
      if (front(fx, 0.012)) c = dark(top, 0.55);                                      // zip
      if (fy < 0.1) c = accent;                                                       // collar
      if (fy > 0.25 && fy < 0.4 && ((fx > 0.28 && fx < 0.42) || (fx > 0.58 && fx < 0.72))) c = dark(top, 0.78); // chest pockets
    }
    if ((outfit.top === 'tee' || outfit.top === 'vtee') && fy < 0.075 && o < 0.2) c = dark(top, 0.62); // ribbed collar around the neck
    if (outfit.top === 'tube' && fy < 0.235) c = dark(top, 0.8);                      // elastic rim
    if (outfit.top === 'tank' && fy < 0.215 + Math.max(0, 0.045 - o) * 3 && fy > 0.2 + Math.max(0, 0.045 - o) * 3 && o < 0.1) c = dark(top, 0.85); // neckline edge
    if (fy > 0.86) c = outfit.top === 'dress' ? accent : dark(accent, 0.9);          // belt / waist band
    if (outfit.top === 'dress' && fy < 0.1) c = dark(top, 0.85);
    return c;
  });
  // pelvis
  paint(CELL.pelvis, (fx, fy) => {
    if (outfit.bottom === 'skirt') return outfit.top === 'dress' ? top : bottom;
    let c: number[] = bottom;
    if (seam(fx)) c = dark(bottom, 0.8);
    if (fy < 0.14) c = dark(accent, 1);                                                // belt
    if (fy < 0.14 && front(fx, 0.04)) c = [190, 170, 90];                              // buckle
    if (fy > 0.14 && front(fx, 0.008)) c = dark(bottom, 0.55);                         // fly
    if (outfit.bottom === 'cargo' && fy > 0.3 && fy < 0.6 && (Math.abs(fx - 0.18) < 0.1 || Math.abs(fx - 0.82) < 0.1)) c = dark(bottom, 0.78);
    return c;
  });
  // arms: sleeve length depends on the top
  const sleeveFull = outfit.top === 'jacket' || outfit.top === 'long';
  paint(CELL.upperArm, (fx, fy) => {
    if (outfit.top === 'bare' || outfit.top === 'tank' || outfit.top === 'tube') return skin;
    if (sleeveFull || outfit.top === 'dress') return seam(fx) ? dark(top, 0.8) : top;
    if (fy < 0.62) return fy > 0.56 ? dark(top, 0.78) : fy < 0.07 ? dark(top, 0.82) : top; // tee: short sleeve, seam at the shoulder, hem at the end
    return skin;
  });
  paint(CELL.foreArm, (fx, fy) => {
    if (sleeveFull) return fy > 0.84 ? accent : (seam(fx) ? dark(top, 0.8) : top);
    return skin;
  });
  paint(CELL.hand, (fx, fy) => {
    if (outfit.gloves) return fy < 0.22 ? accent : dark(accent, fy > 0.78 ? 0.8 : 1);
    return fy < 0.05 ? dark(skin, 0.85) : skin;
  });
  // legs
  paint(CELL.thigh, (fx, fy) => {
    if (outfit.bottom === 'shorts') return fy < 0.55 ? (seam(fx) ? dark(bottom, 0.8) : bottom) : skin;
    if (outfit.bottom === 'skirt') return fy < 0.25 ? bottom : skin;
    let c: number[] = bottom;
    if (seam(fx)) c = dark(bottom, 0.82);
    if (outfit.bottom === 'cargo' && fy > 0.25 && fy < 0.55 && Math.abs(fx - 0.25) < 0.12) c = dark(bottom, 0.75);
    if (outfit.bottom === 'jeans') c = fy > 0.4 && fy < 0.55 ? dark(bottom, 1.15) : c; // faded knee
    return c;
  });
  paint(CELL.shin, (fx, fy) => {
    const boot = outfit.boots && fy > 0.5;
    if (boot) return fy > 0.5 && fy < 0.56 ? accent : (seam(fx) ? dark(shoes, 0.8) : shoes);
    if (outfit.bottom === 'shorts' || outfit.bottom === 'skirt') return fy > 0.84 ? [225, 225, 220] : skin; // socks
    let c: number[] = bottom;
    if (seam(fx)) c = dark(bottom, 0.82);
    if (fy > 0.9) c = dark(bottom, 0.7);                                               // cuff
    return c;
  });
  paint(CELL.foot, (fx, fy) => {
    if (fy > 0.85) return dark(shoes, 0.55);                                           // sole
    if (front(fx, 0.12) && fy > 0.5) return dark(shoes, 1.25);                         // toe cap
    return shoes;
  });
  // skirt / coat skirt
  paint(CELL.skirt, (fx, fy) => {
    const base = outfit.top === 'long' ? top : bottom;
    let c: number[] = base;
    if (Math.abs(((fx * 8) % 1) - 0.5) < 0.05) c = dark(base, 0.8);                    // pleats
    if (fy > 0.9) c = outfit.top === 'long' ? accent : dark(base, 0.7);
    return c;
  });

  ctx.putImageData(img, 0, 0);
  return canvas;
}
