import { zlibSync } from 'fflate';

/**
 * A minimal PDF writer: one page per canvas, each page a single full-page image (compressed RGB). The canvases are rendered
 * at print resolution, so lines and textures stay crisp. Page size is in PDF points (1/72 inch).
 */
export function makePdf(pages: HTMLCanvasElement[], widthPt: number, heightPt: number): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (b: Uint8Array | string) => { const u = typeof b === 'string' ? enc.encode(b) : b; chunks.push(u); size += u.length; };
  const obj = (n: number, body: string | Uint8Array[]) => {
    offsets[n] = size;
    push(`${n} 0 obj\n`);
    if (typeof body === 'string') push(body); else for (const b of body) push(b);
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const pageObj = (i: number) => 3 + i * 3;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`);

  pages.forEach((c, i) => {
    const w = c.width, h = c.height;
    const rgba = c.getContext('2d')!.getImageData(0, 0, w, h).data;
    const rgb = new Uint8Array(w * h * 3);
    for (let p = 0, q = 0; p < rgba.length; p += 4) { rgb[q++] = rgba[p]; rgb[q++] = rgba[p + 1]; rgb[q++] = rgba[p + 2]; }
    const data = zlibSync(rgb, { level: 6 });
    const imgN = pageObj(i) + 1, contentN = pageObj(i) + 2;
    obj(pageObj(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] /Resources << /XObject << /Im0 ${imgN} 0 R >> >> /Contents ${contentN} 0 R >>`);
    obj(imgN, [enc.encode(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`), data, enc.encode('\nendstream')]);
    const content = `q ${widthPt} 0 0 ${heightPt} 0 0 cm /Im0 Do Q`;
    obj(contentN, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  const count = 3 + pages.length * 3;
  const xref = size;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
