import * as THREE from 'three';

export interface Ps1Params {
  /** low-res framebuffer size used for vertex snapping */
  resolution: THREE.Vector2;
  /** 0..1 how much vertices snap to the low-res pixel grid */
  snap: number;
  /** 0..1 blend from perspective-correct to affine (warpy) texture mapping */
  affine: number;
  /** colour levels per channel, 0 = off */
  levels: number;
}

const vertex = /* glsl */ `
  uniform vec2 uRes;
  uniform float uSnap;
  uniform float uAffine;
  varying vec2 vUv;
  varying float vW;
  varying float vLight;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec4 clip = projectionMatrix * mv;

    // PS1 GTE had no sub-pixel precision: snap projected vertices to the pixel grid.
    vec2 ndc = clip.xy / clip.w;
    vec2 grid = uRes * 0.5;
    ndc = mix(ndc, floor(ndc * grid + 0.5) / grid, uSnap);
    clip.xy = ndc * clip.w;
    gl_Position = clip;

    // Vertex (Gouraud) lighting, no per-pixel shading.
    vec3 n = normalize(normalMatrix * normal);
    vLight = 0.74 + 0.3 * max(dot(n, normalize(vec3(0.35, 0.55, 0.75))), 0.0);

    // Affine mapping: uv*w and w are both interpolated perspective-correctly, so uv/w in the
    // fragment shader is the plain screen-space interpolation of uv (what the PS1 did).
    float w = mix(1.0, clip.w, uAffine);
    vUv = uv * w;
    vW = w;
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uLevels;
  varying vec2 vUv;
  varying float vW;
  varying float vLight;

  void main() {
    vec3 c = texture2D(uMap, vUv / vW).rgb * vLight;
    if (uLevels > 0.5) c = floor(c * uLevels + 0.5) / uLevels;
    gl_FragColor = vec4(c, 1.0);
  }
`;

export function createPs1Material(map: THREE.Texture, p: Ps1Params) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uRes: { value: p.resolution },
      uSnap: { value: p.snap },
      uAffine: { value: p.affine },
      uLevels: { value: p.levels },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
  });
}

export function pixelTexture(canvas: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace; // shader writes straight to the framebuffer, no sRGB round-trip
  t.needsUpdate = true;
  return t;
}
