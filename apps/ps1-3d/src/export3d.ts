import * as THREE from 'three';

/**
 * Exports the character as it is on screen, in whatever pose it is in:
 *  - OBJ + MTL + PNG textures (textured; the PS1 look itself is a shader, so the file gets plain textured faces)
 *  - STL (shape only: STL has no colours or textures)
 * Positions are taken relative to the character (not the camera, the on-screen centring or the sway), and the model is
 * shifted so its lowest point sits at y = 0.
 */

interface Piece { name: string; mesh: THREE.Mesh; material: THREE.ShaderMaterial; matrix: THREE.Matrix4 }

function collect(root: THREE.Object3D): Piece[] {
  root.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const pieces: Piece[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const material = mesh.material as THREE.ShaderMaterial;
    pieces.push({
      name: mesh.name || mesh.parent?.name || `part${pieces.length}`,
      mesh, material,
      matrix: new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld),
    });
  });
  return pieces;
}

/** all triangle corners of all pieces, transformed into character space */
function transformed(piece: Piece) {
  const geo = piece.mesh.geometry;
  const pos = geo.getAttribute('position'), uv = geo.getAttribute('uv');
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(piece.matrix);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const out: { p: THREE.Vector3; n: THREE.Vector3; uv: [number, number] }[] = [];
  const tri = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i).applyMatrix4(piece.matrix);
    b.fromBufferAttribute(pos, i + 1).applyMatrix4(piece.matrix);
    c.fromBufferAttribute(pos, i + 2).applyMatrix4(piece.matrix);
    tri.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize(); // flat face normal in character space
    for (const [k, v] of [[0, a], [1, b], [2, c]] as const) {
      p.copy(v); n.copy(tri);
      out.push({ p: p.clone(), n: n.clone(), uv: uv ? [uv.getX(i + k), uv.getY(i + k)] : [0, 0] });
    }
  }
  void normalMatrix;
  return out;
}

function lowestY(pieces: Piece[]): number {
  let min = Infinity;
  for (const piece of pieces) {
    const pos = piece.mesh.geometry.getAttribute('position');
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) min = Math.min(min, v.fromBufferAttribute(pos, i).applyMatrix4(piece.matrix).y);
  }
  return Number.isFinite(min) ? min : 0;
}

async function canvasPng(canvas: HTMLCanvasElement, scale: number): Promise<Uint8Array> {
  let c = canvas;
  if (scale > 1) {
    c = document.createElement('canvas');
    c.width = canvas.width * scale; c.height = canvas.height * scale;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false; // keep the pixels crisp
    ctx.drawImage(canvas, 0, 0, c.width, c.height);
  }
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('png failed'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

export interface ObjExport { obj: string; mtl: string; textures: Record<string, Uint8Array>; triangles: number }

export async function exportObj(root: THREE.Object3D, modelName: string, textureScale: number): Promise<ObjExport> {
  const pieces = collect(root);
  const floor = lowestY(pieces);
  const lines: string[] = [`# Face Maker character`, `mtllib ${modelName}.mtl`];
  let vBase = 1, triangles = 0;
  const materials = new Map<THREE.ShaderMaterial, string>();
  const textures: Record<string, Uint8Array> = {};
  for (const piece of pieces) {
    if (!materials.has(piece.material)) {
      const name = piece.material.name || `material${materials.size}`;
      materials.set(piece.material, name);
      const tex = piece.material.uniforms.uMap.value as THREE.CanvasTexture;
      textures[`textures/${name}.png`] = await canvasPng(tex.image as HTMLCanvasElement, textureScale);
    }
    const verts = transformed(piece);
    lines.push(`o ${piece.name}`, `usemtl ${materials.get(piece.material)}`);
    for (const v of verts) lines.push(`v ${v.p.x.toFixed(5)} ${(v.p.y - floor).toFixed(5)} ${v.p.z.toFixed(5)}`);
    for (const v of verts) lines.push(`vt ${v.uv[0].toFixed(5)} ${v.uv[1].toFixed(5)}`);
    for (const v of verts) lines.push(`vn ${v.n.x.toFixed(4)} ${v.n.y.toFixed(4)} ${v.n.z.toFixed(4)}`);
    for (let i = 0; i < verts.length; i += 3) {
      const f = [0, 1, 2].map((k) => `${vBase + i + k}/${vBase + i + k}/${vBase + i + k}`);
      lines.push(`f ${f.join(' ')}`);
      triangles++;
    }
    vBase += verts.length;
  }
  const mtl = [`# Face Maker character`, ...[...materials.values()].flatMap((name) => [
    `newmtl ${name}`, 'Ka 1 1 1', 'Kd 1 1 1', 'Ks 0 0 0', 'illum 1', `map_Kd textures/${name}.png`, '',
  ])].join('\n');
  return { obj: lines.join('\n') + '\n', mtl, textures, triangles };
}

/** Binary STL, scaled so the model is `heightMm` tall. Shape only: STL cannot hold colour or textures. */
export function exportStl(root: THREE.Object3D, heightMm: number): { data: Uint8Array; triangles: number } {
  const pieces = collect(root);
  const floor = lowestY(pieces);
  const faces: THREE.Vector3[][] = [];
  let top = -Infinity;
  for (const piece of pieces) {
    const verts = transformed(piece);
    for (let i = 0; i < verts.length; i += 3) {
      const tri = [verts[i].p, verts[i + 1].p, verts[i + 2].p].map((p) => new THREE.Vector3(p.x, p.y - floor, p.z));
      for (const t of tri) top = Math.max(top, t.y);
      faces.push(tri);
    }
  }
  const k = heightMm / Math.max(1e-6, top);
  const buf = new ArrayBuffer(84 + faces.length * 50);
  const dv = new DataView(buf);
  new TextEncoder().encodeInto('Face Maker character (binary STL)', new Uint8Array(buf, 0, 80));
  dv.setUint32(80, faces.length, true);
  faces.forEach((tri, i) => {
    const o = 84 + i * 50;
    const n = new THREE.Vector3().subVectors(tri[1], tri[0]).cross(new THREE.Vector3().subVectors(tri[2], tri[0])).normalize();
    [n.x, n.y, n.z].forEach((x, j) => dv.setFloat32(o + j * 4, x, true));
    tri.forEach((p, j) => [p.x * k, p.y * k, p.z * k].forEach((x, m) => dv.setFloat32(o + 12 + j * 12 + m * 4, x, true)));
  });
  return { data: new Uint8Array(buf), triangles: faces.length };
}
