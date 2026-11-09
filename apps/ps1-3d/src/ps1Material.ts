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
  varying vec3 vPos;

  void main() {
    vPos = position;
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
  uniform float uHatch;
  uniform float uSpeckle;
  uniform float uSkinSurf; // 0 none, 1 soft, 2 grain, 3 freckled
  uniform float uSkinAmt;
  uniform float uTexStrength;
  uniform vec2 uReserved;
  varying vec2 vUv;
  varying float vW;
  varying float vLight;
  varying vec3 vPos;

  void main() {
    vec2 uv = vUv / vW;
    // open shells (hair, hats) are drawn from both sides; the inside of a wall is lit like its outside, a little darker
    vec3 c = texture2D(uMap, uv).rgb * vLight * (gl_FrontFacing ? 1.0 : 0.82);
    // The head texture keeps a few flat-colour texels (hair / back of the head, skin for ears, neck and chin) in its top-left
    // corner. Engraved faces get fine diagonal hatching over exactly those areas, so they match the hatched body.
    // the skin colour texel (second block of the reserved corner) is flat, so it gets its surface texture here
    if (uSkinSurf > 0.5 && uv.x > uReserved.x * 0.5 && uv.x < uReserved.x && uv.y > uReserved.y) {
      vec3 q3 = floor(vPos * 30.0);
      float h = fract(sin(dot(q3, vec3(12.9898, 78.233, 37.719))) * 43758.5453) - 0.5;
      float f = 1.0 + h * 0.1 * uSkinAmt;
      if (uSkinSurf < 1.5) f += (sin(vPos.x * 9.0 + vPos.y * 4.0) * sin(vPos.y * 7.0 + vPos.z * 5.0) + 0.6 * sin((vPos.x + vPos.y + vPos.z) * 4.0)) * 0.035 * uSkinAmt;
      else if (uSkinSurf > 2.5 && fract(sin(dot(floor(vPos * 22.0), vec3(3.7, 9.1, 5.3))) * 24634.6345) > 0.985) f -= 0.16 * uSkinAmt;
      c *= f;
    }
    if ((uHatch > 0.5 || uSpeckle > 0.5) && uv.x < uReserved.x && uv.y > uReserved.y) {
      if (uHatch > 0.5) {
        float d = vPos.x * 0.7 + vPos.y + vPos.z * 0.5;
        float line = step(0.6, fract(d / 0.1));
        c *= 1.0 - 0.24 * uTexStrength * line;
      }
      if (uSpeckle > 0.5) {
        // stipple: a hash of the surface cell decides which cells are dark dots or light flecks
        vec3 q = floor(vPos * 24.0);
        float h = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        if (h > 0.84) c *= 1.0 - 0.34 * uTexStrength;
        else if (h < 0.035) c *= 1.0 + 0.12 * uTexStrength;
      }
    }
    if (uLevels > 0.5) c = floor(c * uLevels + 0.5) / uLevels;
    gl_FragColor = vec4(c, 1.0);
  }
`;

export function createPs1Material(map: THREE.Texture, p: Ps1Params, doubleSided = false) {
  return new THREE.ShaderMaterial({
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    uniforms: {
      uMap: { value: map },
      uRes: { value: p.resolution },
      uSnap: { value: p.snap },
      uAffine: { value: p.affine },
      uLevels: { value: p.levels },
      uHatch: { value: 0 },
      uSpeckle: { value: 0 },
      uSkinSurf: { value: 0 },
      uSkinAmt: { value: 1 },
      uTexStrength: { value: 1 },
      uReserved: { value: new THREE.Vector2(0, 2) }, // never matches until a head sets its flat-colour corner
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
