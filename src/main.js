// 東京タワー 夜景 — コードだけで描く 3D の街(60秒)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Water } from 'three/addons/objects/Water.js';

const V3 = THREE.Vector3;
const W = 1920, H = 1080, DURATION = 60;
const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture');

// ---------- 乱数・補助 ----------
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(20261113);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = x => Math.min(1, Math.max(0, x));
const smooth = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
const mod = (a, n) => ((a % n) + n) % n;

// ---------- 地形(陸・海・公園) ----------
const CITY_R = 3200;
const bayD = (x, z) => x * 0.5 + z * 0.866;
const bayP = (x, z) => x * 0.866 - z * 0.5;
function isLand(x, z) { const d = bayD(x, z), p = bayP(x, z); return d < 1050 || (d > 1900 && d < 2600 && Math.abs(p - 300) < 1000); }
const inPark = (x, z) => Math.abs(x) < 180 && Math.abs(z) < 225;
const inTown = (x, z) => x > 180 && x < 900 && z > -225 && z < 315;   // 大門の町並み
const townRoofs = [];

// ---------- 共有 uniform ----------
const FOG_COLOR = new THREE.Color().setRGB(0.050, 0.033, 0.040);
const MOON_DIR = new V3(0.25, 0.42, 0.87).normalize();
const U = {
  time: { value: 0 }, scale: { value: 1483 }, lit: { value: 0 }, glow: { value: 0 },
  sparkle: { value: 0 }, fogK: { value: 2.6e-4 }, fogColor: { value: FOG_COLOR },
};

// ---------- レンダラ ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, W / H, 2, 30000);

// ---------- 光の点(街灯・車・航空障害灯・星…) ----------
class LightSet {
  constructor() { this.pos = []; this.col = []; this.size = []; this.blink = []; }
  add(x, y, z, r, g, b, size, mode = 0, phase = 0) { this.pos.push(x, y, z); this.col.push(r, g, b); this.size.push(size); this.blink.push(mode, phase); return this.size.length - 1; }
  get count() { return this.size.length; }
  build(fog = 1) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(this.size), 1));
    g.setAttribute('aBlink', new THREE.BufferAttribute(new Float32Array(this.blink), 2));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: U.time, uScale: U.scale, uLit: U.lit, uSparkle: U.sparkle, uFogK: U.fogK, uFog: { value: fog } },
      vertexShader: /* glsl */`
        attribute vec3 aColor; attribute float aSize; attribute vec2 aBlink;
        uniform float uTime, uScale, uLit, uSparkle, uFogK, uFog;
        varying vec3 vColor;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float dist = max(-mv.z, 1.0);
          float a = 1.0; vec3 c = aColor; float size = aSize;
          int mode = int(aBlink.x + 0.5);
          if (mode == 1) { float s = sin(uTime * 2.4 + aBlink.y * 6.2831); a = 0.10 + 0.90 * smoothstep(-0.2, 0.9, s); }
          else if (mode == 2) { a = 0.6 + 0.4 * sin(uTime * (2.0 + aBlink.y * 5.0) + aBlink.y * 40.0); }
          else if (mode == 3) {
            a = 1.0 - smoothstep(uLit - 20.0, uLit, position.y);
            float sp = step(0.90, hash(vec2(aBlink.y * 731.3, floor(uTime * 9.0)))) * uSparkle;
            c = c * a + vec3(0.9, 1.0, 1.3) * sp * 2.6; a = 1.0; size *= 1.0 + sp * 0.9;
          }
          float ps = size * uScale / dist;
          if (ps < 1.8) { a *= ps / 1.8; ps = 1.8; }
          ps = min(ps, uScale * 0.014);
          float fog = exp(-dist * dist * uFogK * uFogK * uFog);
          vColor = c * a * fog;
          gl_PointSize = ps;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor;
        void main(){
          vec2 d = gl_PointCoord - 0.5; float r2 = dot(d, d) * 4.0;
          if (r2 > 1.0) discard;
          float i = exp(-r2 * 3.5) * (1.0 - r2);
          gl_FragColor = vec4(vColor * i, 1.0);
        }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    });
    const p = new THREE.Points(g, m); p.frustumCulled = false; return p;
  }
}

// ---------- 首都高(→ 湾の橋)の曲線 ----------
const hwCurve = new THREE.CatmullRomCurve3([
  [-3400, 18, -900], [-2600, 18, -760], [-1700, 18, -600], [-900, 18, -430], [-350, 18, -330], [200, 18, -310], [540, 18, -140],
  [690, 22, 240], [750, 36, 540], [785, 50, 759], [926.7, 50, 1004.3], [1068.3, 50, 1249.7], [1210, 50, 1495],
  [1380, 30, 1800], [1500, 18, 2150], [1550, 18, 2700],
].map(a => new V3(...a)), false, 'centripetal');
const HW_N = 1600;
const hwLUT = hwCurve.getSpacedPoints(HW_N);
const hwLen = hwCurve.getLength();
function hwAt(s, out) { const f = clamp01(s / hwLen) * HW_N; const i = Math.min(HW_N - 1, Math.floor(f)); return out.lerpVectors(hwLUT[i], hwLUT[i + 1], f - i); }
function hwLeft(s, out) { const f = clamp01(s / hwLen) * HW_N; const i = Math.min(HW_N - 1, Math.floor(f)); const a = hwLUT[i], b = hwLUT[i + 1]; const dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; return out.set(dz / l, 0, -dx / l); }
function distToHw(x, z) { let m = 1e9; for (let i = 0; i <= HW_N; i += 2) { const p = hwLUT[i]; const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < m) m = d; } return Math.sqrt(m); }
function nearestHwIndex(x, z) { let m = 1e9, k = 0; for (let i = 0; i <= HW_N; i++) { const p = hwLUT[i]; const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < m) { m = d; k = i; } } return k; }
const BR_A = nearestHwIndex(785, 759), BR_B = nearestHwIndex(1210, 1495);

// ============================================================
// 空・月
// ============================================================
{
  const sky = new THREE.Mesh(new THREE.SphereGeometry(20000, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uMoon: { value: MOON_DIR }, uHor: { value: FOG_COLOR } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir; uniform vec3 uMoon, uHor;
      void main(){
        vec3 d = normalize(vDir); float h = max(d.y, 0.0);
        vec3 zen = vec3(0.005, 0.009, 0.026);
        vec3 col = mix(uHor, zen, 1.0 - exp(-h * 4.5));
        col += vec3(0.05, 0.022, 0.012) * exp(-h * 14.0);
        float md = acos(clamp(dot(d, uMoon), -1.0, 1.0));
        float R = 0.013;
        col += vec3(1.0, 0.96, 0.86) * 1.15 * (1.0 - smoothstep(R * 0.92, R, md));
        col += vec3(0.5, 0.55, 0.7) * (0.06 * exp(-md * 22.0) + 0.012 * exp(-md * 5.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  sky.frustumCulled = false; sky.renderOrder = -10;
  scene.add(sky);

  const stars = new LightSet();
  for (let i = 0; i < 900; i++) {
    const y = 0.12 + rnd() * 0.88, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y);
    const b = 0.25 + rnd() * rnd() * 0.9;
    stars.add(r * Math.cos(a) * 15000, y * 15000, r * Math.sin(a) * 15000, 0.8 * b, 0.88 * b, 1.0 * b, 14 + rnd() * 12, 2, rnd());
  }
  scene.add(stars.build(0));
}

// ============================================================
// 東京タワー
// ============================================================
const towerDyn = [];   // 点灯にあわせて色を変える部品
{
  const wf = h => 2.2 + 42 * Math.exp(-h / 88);
  const lw = h => 15 - h * 0.09;
  const beams = [];
  const lamps = new LightSet();
  const beam = (a, b, t) => beams.push([a, b, t]);
  const lamp = (p, s = 5) => lamps.add(p.x, p.y, p.z, 0.40, 0.040, 0.007, s * 0.8, 3, rnd());
  const faceP = (f, u, h, inset = 0) => { const w = wf(h) - inset; const p = [[u, w], [w, -u], [-u, -w], [-w, u]][f]; return new V3(p[0], h, p[1]); };

  // 脚(0〜66m)
  const legLv = [0, 11, 22, 33, 44, 55, 66];
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    const ring = h => { const w = wf(h), l = lw(h); return [new V3(sx * w, h, sz * w), new V3(sx * (w - l), h, sz * w), new V3(sx * (w - l), h, sz * (w - l)), new V3(sx * w, h, sz * (w - l))]; };
    for (let k = 0; k < legLv.length - 1; k++) {
      const A = ring(legLv[k]), B = ring(legLv[k + 1]);
      for (let q = 0; q < 4; q++) {
        const q2 = (q + 1) % 4;
        beam(A[q], B[q], q === 0 ? 2.0 : 1.3);
        beam(B[q], B[q2], 0.8);
        beam(A[q], B[q2], 0.55); beam(A[q2], B[q], 0.55);
        lamp(B[q], q === 0 ? 5.5 : 4);
      }
      if (k === 0) for (let q = 0; q < 4; q++) lamp(A[q], 6);
    }
  }
  // 脚のあいだのアーチと帯
  for (let f = 0; f < 4; f++) {
    const u0 = wf(18) - lw(18), N = 16;
    const hA = u => 58 - 40 * (u / u0) ** 2;
    let prev = null, prev2 = null;
    for (let i = 0; i <= N; i++) {
      const u = lerp(-u0, u0, i / N), h = hA(u);
      const p = faceP(f, u, h), p2 = faceP(f, u, Math.min(h + 6, 61));
      if (prev) { beam(prev, p, 1.0); beam(prev2, p2, 0.7); }
      beam(p, p2, 0.45); if (i % 2 === 0) lamp(p, 4);
      prev = p; prev2 = p2;
    }
    const bp = (h, fr) => faceP(f, fr * (wf(h) - lw(h)), h);
    for (let b = 0; b < 3; b++) {
      const a = -1 + 2 * b / 3, c = -1 + 2 * (b + 1) / 3;
      beam(bp(55, a), bp(55, c), 0.8); beam(bp(66, a), bp(66, c), 0.9);
      beam(bp(55, a), bp(66, c), 0.5); beam(bp(55, c), bp(66, a), 0.5);
      if (b > 0) beam(bp(55, a), bp(66, a), 0.6);
      lamp(bp(66, a), 4);
    }
  }
  // 本体の格子
  function lattice(levels, baysFn, tChord, tBr) {
    for (let k = 0; k < levels.length - 1; k++) {
      const h0 = levels[k], h1 = levels[k + 1];
      for (let f = 0; f < 4; f++) {
        const n = baysFn(h0);
        for (let b = 0; b < n; b++) {
          const a = -1 + 2 * b / n, c = -1 + 2 * (b + 1) / n;
          const p00 = faceP(f, a * wf(h0), h0), p01 = faceP(f, c * wf(h0), h0), p10 = faceP(f, a * wf(h1), h1), p11 = faceP(f, c * wf(h1), h1);
          beam(p00, p11, tBr); beam(p01, p10, tBr); beam(p10, p11, tBr * 1.15);
          if (b === 0) { beam(p00, p10, tChord); lamp(p10, 5); } else { beam(p00, p10, tBr * 1.2); lamp(p10, 3.5); }
        }
      }
    }
  }
  lattice([66, 76, 86, 95, 104, 112, 120, 127, 134, 140, 145], h => h < 104 ? 4 : 2, 1.6, 0.6);
  lattice([145, 157], () => 1, 1.4, 0.01);
  lattice([157, 165, 173, 181, 189, 197, 205, 213, 221, 229, 237, 246], h => h < 189 ? 2 : 1, 1.2, 0.5);
  // アンテナ
  beam(new V3(0, 254, 0), new V3(0, 284, 0), 3.4); beam(new V3(0, 284, 0), new V3(0, 311, 0), 2.1); beam(new V3(0, 311, 0), new V3(0, 333, 0), 1.0);
  for (const y of [262, 272, 284, 297, 311]) lamp(new V3(0, y, 0), 6);

  // 梁をまとめて描く
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uLit: U.lit, uFogK: U.fogK, uFogColor: U.fogColor },
    vertexShader: `varying vec3 vW; void main(){ vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      varying vec3 vW; uniform float uLit, uFogK; uniform vec3 uFogColor;
      void main(){
        float lit = 1.0 - smoothstep(uLit - 26.0, uLit, vW.y);
        float g = clamp(vW.y / 333.0, 0.0, 1.0);
        vec3 paint = vec3(0.018, 0.003, 0.002);
        vec3 glow = mix(vec3(1.0, 0.070, 0.010), vec3(1.0, 0.105, 0.018), g) * mix(0.80, 0.95, g);
        // 朱と白の塗り分け
        float band = smoothstep(104.0, 107.0, vW.y) * (1.0 - smoothstep(124.0, 127.0, vW.y))
                   + smoothstep(176.0, 179.0, vW.y) * (1.0 - smoothstep(196.0, 199.0, vW.y))
                   + smoothstep(226.0, 229.0, vW.y) * (1.0 - smoothstep(244.0, 247.0, vW.y))
                   + step(254.0, vW.y) * step(0.5, fract((vW.y - 254.0) / 26.0));
        glow = mix(glow, vec3(1.0, 0.50, 0.32) * 0.85, clamp(band, 0.0, 1.0) * 0.75);
        float edge = exp(-abs(vW.y - uLit) / 7.0) * step(1.0, uLit) * step(uLit, 345.0);
        vec3 col = paint + glow * lit + vec3(1.0, 0.8, 0.55) * edge * 1.6;
        float dist = length(vW - cameraPosition);
        col = mix(col, uFogColor, (1.0 - exp(-dist * dist * uFogK * uFogK)) * 0.6);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, beams.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new V3(0, 1, 0), dir = new V3(), mid = new V3(), sc = new V3();
  beams.forEach(([a, b, t], i) => {
    dir.subVectors(b, a); const len = dir.length(); dir.normalize();
    q.setFromUnitVectors(up, dir); mid.addVectors(a, b).multiplyScalar(0.5); sc.set(t, len + t * 0.5, t);
    mesh.setMatrixAt(i, m4.compose(mid, q, sc));
  });
  mesh.frustumCulled = false; scene.add(mesh);

  // きらめき(ダイヤモンドヴェール風)用の点
  for (let i = 0; i < 1800; i++) {
    const [a, b] = beams[Math.floor(rnd() * beams.length)]; const t = rnd();
    lamps.add(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t), 0, 0, 0, 5.5, 3, rnd());
  }
  scene.add(lamps.build(0.3));

  // 展望台・エレベーター・足もとの建物
  const dyn = (mesh, y, off, on) => { towerDyn.push({ mat: mesh.material, y, off: new THREE.Color().setRGB(...off), on: new THREE.Color().setRGB(...on) }); scene.add(mesh); return mesh; };
  const box = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial()); m.position.set(x, y + h / 2, z); return m; };
  dyn(box(9, 145, 9, 0, 0, 0), 70, [0.004, 0.003, 0.003], [0.06, 0.009, 0.004]);
  dyn(box(31, 12, 31, 0, 145, 0), 150, [0.006, 0.004, 0.004], [0.12, 0.018, 0.007]);
  dyn(box(31.6, 2.6, 31.6, 0, 147.4, 0), 150, [0.006, 0.006, 0.006], [1.15, 0.80, 0.42]);
  dyn(box(31.6, 2.6, 31.6, 0, 152.4, 0), 153, [0.006, 0.006, 0.006], [1.15, 0.80, 0.42]);
  dyn(box(33, 0.8, 33, 0, 144.4, 0), 146, [0.006, 0.006, 0.006], [0.9, 0.5, 0.2]);
  const cyl = (r, h, y) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 8), new THREE.MeshBasicMaterial()); m.position.y = y + h / 2; m.rotation.y = Math.PI / 8; return m; };
  dyn(cyl(8, 9, 245.5), 250, [0.006, 0.004, 0.004], [0.12, 0.018, 0.007]);
  dyn(cyl(8.3, 2.6, 248.6), 250, [0.006, 0.006, 0.006], [1.2, 0.85, 0.48]);
  dyn(box(58, 17, 58, 0, 0, 0), 9, [0.005, 0.005, 0.006], [0.035, 0.018, 0.010]);
  dyn(box(58.6, 3.2, 58.6, 0, 1.2, 0), 3, [0.10, 0.08, 0.05], [0.75, 0.55, 0.32]);
  dyn(box(58.6, 1.6, 58.6, 0, 9.5, 0), 10, [0.05, 0.04, 0.03], [0.45, 0.32, 0.18]);
}

// ============================================================
// ビル群
// ============================================================
const street = new LightSet();   // 動かない光(街灯・ネオン・航空障害灯)
{
  const clusters = [[-650, -280, 260, 1.0], [-200, -1150, 320, 1.0], [820, -950, 300, 0.9], [-1350, 250, 320, 0.8], [1250, -600, 240, 0.7],
    [-350, 1500, 300, 0.6], [1500, -300, 280, 0.6], [-1900, -1300, 350, 0.7], [1385, 1900, 300, 0.5], [300, -2100, 320, 0.6]];
  const field = (x, z) => { let s = 0; for (const [cx, cz, r, a] of clusters) s += a * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r)); return Math.min(s, 1.2); };
  const B = [];
  const neon = [[1, 0.1, 0.25], [0.1, 0.9, 1], [1, 0.25, 0.9], [0.2, 1, 0.4], [1, 0.75, 0.1], [0.3, 0.45, 1], [1, 0.2, 0.05]];
  function addB(x, z, w, d, h, y0 = 0, seed = rnd(), kind = 0) { B.push([x, z, w, d, h, y0, seed, kind]); }
  function tryB(x0, x1, z0, z1, h, tall, kind = 0) {
    const w = x1 - x0, d = z1 - z0, x = (x0 + x1) / 2, z = (z0 + z1) / 2;
    if (w < 6 || d < 6) return;
    for (const [px, pz] of [[x, z], [x0, z0], [x1, z0], [x0, z1], [x1, z1]]) if (!isLand(px, pz)) return;
    if (distToHw(x, z) < 15 + Math.max(w, d) * 0.55) return;
    if (tall && rnd() < 0.5) {
      const h1 = h * (0.55 + rnd() * 0.25), s = 0.62 + rnd() * 0.2;
      addB(x, z, w, d, h1); addB(x, z, w * s, d * s, h - h1, h1);
    } else addB(x, z, w, d, h, 0, rnd(), kind);
    if (kind === 1 && h < 11) { if (rnd() < 0.75) townRoofs.push([x, z, w, d, h, 1.6 + rnd() * 1.6]); }
    else if (h > 12 && rnd() < 0.5) addB(x + (rnd() - 0.5) * w * 0.3, z + (rnd() - 0.5) * d * 0.3, w * 0.35, d * 0.35, 2.5 + rnd() * 3, h);
    if (h > 58) {
      const ph = rnd(), s = tall ? 0.42 : 0.5;
      street.add(x + w * s, h + 2, z + d * s, 1, 0.05, 0.03, 5, 1, ph); street.add(x - w * s, h + 2, z - d * s, 1, 0.05, 0.03, 5, 1, ph);
      if (h > 150) { street.add(x + w * 0.5, h * 0.55, z - d * 0.5, 1, 0.05, 0.03, 4.5, 1, ph); street.add(x - w * 0.5, h * 0.55, z + d * 0.5, 1, 0.05, 0.03, 4.5, 1, ph); }
    } else if (rnd() < (kind === 1 ? 0.8 : 0.22) && Math.hypot(x, z) < 2200) {
      const c = kind === 1 && rnd() < 0.6 ? [[1, 0.5, 0.15], [1, 0.16, 0.05], [1, 0.8, 0.5]][Math.floor(rnd() * 3)] : neon[Math.floor(rnd() * neon.length)];
      const side = rnd() < 0.5 ? -1 : 1, y = kind === 1 ? 2.4 + rnd() * Math.min(h - 2.4, 4.5) : 3 + rnd() * Math.min(h - 3, 14);
      if (rnd() < 0.5) street.add(x + side * (w / 2 + 0.6), y, z + (rnd() - 0.5) * d * 0.7, c[0], c[1], c[2], 3.2);
      else street.add(x + (rnd() - 0.5) * w * 0.7, y, z + side * (d / 2 + 0.6), c[0], c[1], c[2], 3.2);
    }
  }
  for (let i = -37; i < 37; i++) for (let j = -37; j < 37; j++) {
    const X0 = 90 * i, X1 = X0 + 90, Z0 = 45 + 90 * j, Z1 = Z0 + 90;
    const cx = X0 + 45, cz = Z0 + 45, R = Math.hypot(cx, cz);
    if (R > CITY_R || inPark(cx, cz)) continue;
    const bx0 = X0 + (mod(i, 5) === 0 ? 13 : 6) + 3, bx1 = X1 - (mod(i + 1, 5) === 0 ? 13 : 6) - 3;
    const bz0 = Z0 + (mod(j, 5) === 2 ? 13 : 6) + 3, bz1 = Z1 - (mod(j + 1, 5) === 2 ? 13 : 6) - 3;
    const f = field(cx, cz), edge = 1 - smooth((R - 2300) / 900) * 0.5;
    if (inTown(cx, cz)) {
      const nx = 3 + Math.floor(rnd() * 2), nz = 2 + Math.floor(rnd() * 2);
      for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
        if (rnd() < 0.04) continue;
        const g = 0.4 + rnd() * 1.1, r = rnd();
        const h = r < 0.74 ? 5.5 + rnd() * 3.8 : r < 0.95 ? 10 + rnd() * 7 : 24 + rnd() * 16;   // 二階家・雑居ビル・たまにマンション
        tryB(lerp(bx0, bx1, a / nx) + g, lerp(bx0, bx1, (a + 1) / nx) - g, lerp(bz0, bz1, b / nz) + g, lerp(bz0, bz1, (b + 1) / nz) - g, h, false, 1);
      }
    } else if (rnd() < 0.03 + 0.55 * f) {
      const ins = 3 + rnd() * 9;
      const h = Math.min(245, (65 + 190 * Math.pow(rnd(), 1.4) * Math.min(1, 0.4 + f)) * edge);
      tryB(bx0 + ins, bx1 - ins, bz0 + ins, bz1 - ins, h, true);
    } else {
      const nx = 1 + Math.floor(rnd() * 3), nz = 1 + Math.floor(rnd() * 3);
      for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
        if (rnd() < 0.05) continue;
        const g = 1 + rnd() * 2.5;
        const h = (9 + 36 * rnd() * rnd() * (1 + 1.3 * f) + (rnd() < 0.07 ? 25 + 30 * rnd() : 0)) * edge;
        tryB(lerp(bx0, bx1, a / nx) + g, lerp(bx0, bx1, (a + 1) / nx) - g, lerp(bz0, bz1, b / nz) + g, lerp(bz0, bz1, (b + 1) / nz) - g, h, false);
      }
    }
  }

  addB(990, 596, 26, 100, 19);   // 駅
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const n = B.length, aSize = new Float32Array(n * 3), aSeed = new Float32Array(n), aKind = new Float32Array(n);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uFogK: U.fogK, uFogColor: U.fogColor, uGlow: U.glow },
    vertexShader: /* glsl */`
      attribute vec3 aSize; attribute float aSeed, aKind;
      varying vec3 vLocal, vN, vW, vSize; varying float vSeed, vKind;
      void main(){
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vLocal = position * aSize; vN = normal; vW = wp.xyz; vSeed = aSeed; vSize = aSize; vKind = aKind;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vLocal, vN, vW, vSize; varying float vSeed, vKind;
      uniform float uFogK, uGlow; uniform vec3 uFogColor;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        float s = vSeed * 97.0;
        vec3 base = mix(vec3(0.0030, 0.0036, 0.0065), vec3(0.0095, 0.0095, 0.0125), hash(vec2(s, 1.0)));
        vec3 col;
        if (abs(vN.y) > 0.5) {
          col = base * 1.5;
        } else {
          bool xf = abs(vN.x) > 0.5;
          float along = xf ? vLocal.z : vLocal.x;
          float span = xf ? vSize.z : vSize.x;
          float face = xf ? (vN.x > 0.0 ? 1.0 : 2.0) : (vN.z > 0.0 ? 3.0 : 4.0);
          bool town = vKind > 0.5;
          float fh = town ? mix(2.7, 3.2, hash(vec2(s, 2.0))) : mix(3.2, 4.3, hash(vec2(s, 2.0)));
          float ww = town ? mix(1.8, 2.8, hash(vec2(s, 3.0))) : mix(2.2, 4.6, hash(vec2(s, 3.0)));
          float nW = max(1.0, floor(span / ww)), nF = max(1.0, floor(vSize.y / fh));
          vec2 uv = vec2((along / span + 0.5) * nW, vLocal.y / vSize.y * nF);
          vec2 id = floor(uv), f = fract(uv);
          float litRatio = town ? mix(0.38, 0.78, hash(vec2(s, 4.0))) : mix(0.12, 0.62, hash(vec2(s, 4.0)));
          float office = step(0.45, hash(vec2(s, 5.0))) * step(40.0, vSize.y) * 0.75;
          float r = hash(id + vec2(s * 1.7, face * 13.3));
          float fr = hash(vec2(id.y * 3.1 + face, s * 7.1));
          float lit = step(1.0 - litRatio, mix(r, fr, office));
          float inten = mix(0.12, 0.78, hash(id * 1.3 + s));
          if (id.y < 0.5) { lit = step(town ? 0.12 : 0.3, r); inten = town ? 0.62 : 0.8; }
          float tone = hash(vec2(s, 6.0));
          vec3 tc = tone < 0.42 ? vec3(1.0, 0.60, 0.26) : (tone < 0.66 ? vec3(1.0, 0.82, 0.58) : (tone < 0.9 ? vec3(0.58, 0.78, 1.0) : vec3(0.66, 1.0, 0.80)));
          if (town) tc = tone < 0.6 ? vec3(1.0, 0.48, 0.16) : vec3(1.0, 0.66, 0.34);
          vec3 wc = mix(tc, vec3(1.0, 0.66, 0.34), step(0.82, hash(id * 2.3 + s)) * 0.8);
          float mask = smoothstep(0.08, 0.15, f.x) * smoothstep(0.92, 0.85, f.x) * smoothstep(0.16, 0.25, f.y) * smoothstep(0.86, 0.78, f.y);
          // 窓の中の表情(桟・天井の明るさ・ブラインド)
          float pane = 0.35 + 0.65 * smoothstep(0.0, 0.035, abs(f.x - 0.5));
          float grad = mix(0.45, 1.15, smoothstep(0.2, 0.85, f.y));
          float blind = mix(1.0, 0.35 + 0.65 * step(hash(id * 4.7 + s) * 0.6 + 0.3, f.y), step(0.6, hash(id * 3.3 + s)));
          mask *= pane * grad * blind;
          if (town && id.y < 0.5) mask = smoothstep(0.03, 0.07, f.x) * smoothstep(0.97, 0.93, f.x) * smoothstep(0.04, 0.10, f.y) * smoothstep(0.82, 0.74, f.y) * mix(0.6, 1.0, f.y);
          float fw = max(fwidth(uv.x), fwidth(uv.y));
          float detail = 1.0 - smoothstep(0.35, 1.1, fw);
          vec3 avg = tc * litRatio * 0.13;
          col = base + mix(avg, wc * lit * mask * inten, detail);
          col += vec3(0.020, 0.012, 0.007) * exp(-vW.y / 16.0);
          // タワーの灯りの照り返し
          vec2 toT = -vW.xz; float dT = length(toT);
          float facing = max(dot(vN.xz, toT / max(dT, 1.0)), 0.0);
          col += vec3(1.0, 0.13, 0.035) * 0.055 * uGlow * facing * exp(-dT / 300.0);
        }
        float dist = length(vW - cameraPosition);
        col = mix(col, uFogColor, 1.0 - exp(-dist * dist * uFogK * uFogK));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const m4 = new THREE.Matrix4();
  B.forEach(([x, z, w, d, h, y0, seed, kind], i) => {
    m4.makeScale(w, h, d); m4.setPosition(x, y0, z); mesh.setMatrixAt(i, m4);
    aSize.set([w, h, d], i * 3); aSeed[i] = seed; aKind[i] = kind;
  });
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(aSize, 3));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
  geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(aKind, 1));
  mesh.frustumCulled = false; scene.add(mesh);
  window.__buildings = n;
}

// ============================================================
// 地面・公園・増上寺ふうの寺
// ============================================================
{
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: { uFogK: U.fogK, uFogColor: U.fogColor, uGlow: U.glow },
    vertexShader: `varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      varying vec3 vW; uniform float uFogK, uGlow; uniform vec3 uFogColor;
      void main(){
        vec2 p = vW.xz;
        float bd = p.x * 0.5 + p.y * 0.866, bp = p.x * 0.866 - p.y * 0.5;
        bool land = bd < 1050.0 || (bd > 1900.0 && bd < 2600.0 && abs(bp - 300.0) < 1000.0) || bd > 5200.0;
        if (!land) discard;
        float R = length(p);
        float dx = abs(mod(p.x + 45.0, 90.0) - 45.0), dz = abs(mod(p.y, 90.0) - 45.0);
        float ix = floor((p.x + 45.0) / 90.0), jz = floor(p.y / 90.0);
        bool avx = mod(ix, 5.0) < 0.5, avz = abs(mod(jz, 5.0) - 2.0) < 0.5;
        float hx = avx ? 13.0 : 6.0, hz = avz ? 13.0 : 6.0;
        float rx = 1.0 - smoothstep(hx - 0.6, hx, dx), rz = 1.0 - smoothstep(hz - 0.6, hz, dz);
        float road = max(rx, rz);
        float pool = 0.6 + 0.4 * cos((rx > rz ? p.y : p.x) * 6.2831 / 36.0);
        vec3 roadCol = vec3(0.010, 0.009, 0.008) + vec3(0.050, 0.030, 0.015) * pool * ((rx > rz ? avx : avz) ? 1.5 : 0.8);
        // 車線
        float dl = rx > rz ? dx : dz; bool av = rx > rz ? avx : avz; float al = rx > rz ? p.y : p.x;
        float fwp = fwidth(p.x) + fwidth(p.y);
        if (av) roadCol += vec3(0.035) * (1.0 - smoothstep(0.10, 0.22, abs(dl - 5.6))) * step(0.5, fract(al / 12.0)) * (1.0 - smoothstep(0.3, 1.0, fwp))
                         + vec3(0.035, 0.028, 0.010) * (1.0 - smoothstep(0.15, 0.30, dl)) * (1.0 - smoothstep(0.3, 1.0, fwp));
        if (p.x > 180.0 && p.x < 900.0 && p.y > -225.0 && p.y < 315.0) roadCol += vec3(0.075, 0.032, 0.012) * (abs(p.y - 45.0) < 8.0 ? 0.9 : 0.45);
        vec3 blockCol = vec3(0.0045, 0.0042, 0.005);
        vec3 col = mix(blockCol, roadCol, road);
        float detail = 1.0 - smoothstep(12.0, 50.0, fwp);
        col = mix(vec3(0.014, 0.010, 0.008), col, detail);
        col = mix(col, vec3(0.004, 0.004, 0.0045), smoothstep(3100.0, 3400.0, R));
        if (abs(p.x) < 180.0 && abs(p.y) < 225.0) {
          col = vec3(0.002, 0.0045, 0.0025);
          col = mix(vec3(0.011, 0.010, 0.009), col, smoothstep(72.0, 80.0, R));
          if (p.x > 76.0 && p.x < 177.0 && abs(p.y - 45.0) < 36.0) col = vec3(0.020, 0.016, 0.012);
          float path = (1.0 - smoothstep(5.0, 6.5, abs(p.y - 45.0))) * step(100.0, p.x) + (1.0 - smoothstep(4.0, 6.0, abs(p.x))) * step(70.0, abs(p.y));
          col = mix(col, vec3(0.016, 0.013, 0.010), clamp(path, 0.0, 1.0));
        }
        col += vec3(1.0, 0.14, 0.035) * 0.08 * uGlow * exp(-R / 110.0);
        float dist = length(vW - cameraPosition);
        col = mix(col, uFogColor, 1.0 - exp(-dist * dist * uFogK * uFogK));
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  ground.frustumCulled = false; scene.add(ground);

  const litMat = (tint, glowK = 1) => new THREE.ShaderMaterial({
    uniforms: { uTint: { value: new THREE.Color().setRGB(...tint) }, uGlow: U.glow, uK: { value: glowK } },
    vertexShader: /* glsl */`
      varying vec3 vN, vW;
      void main(){
        #ifdef USE_INSTANCING
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          vec4 wp = modelMatrix * vec4(position, 1.0);
        #endif
        vN = normalize(mat3(modelMatrix) * normal); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vN, vW; uniform vec3 uTint; uniform float uGlow, uK;
      void main(){
        vec3 n = normalize(vN);
        vec3 toT = vec3(0.0, 130.0, 0.0) - vW; float d = length(toT);
        vec3 col = uTint * (0.55 + 0.45 * n.y);
        col += vec3(1.0, 0.15, 0.04) * uK * uGlow * max(dot(n, toT / d), 0.0) * exp(-d / 240.0) * 0.10;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  // 木
  const tints = [[0.0035, 0.008, 0.0035], [0.005, 0.010, 0.004], [0.003, 0.0065, 0.0045]];
  const trees = tints.map(() => []);
  for (let i = 0; i < 1500; i++) {
    const x = (rnd() * 2 - 1) * 172, z = (rnd() * 2 - 1) * 217;
    if (Math.hypot(x, z) < 84) continue;
    if (x > 68 && z > 5 && z < 85) continue;                    // 寺の敷地
    if (Math.abs(x) < 9 && Math.abs(z) > 70) continue;          // 並木道
    trees[Math.floor(rnd() * 3)].push([x, z, 4 + rnd() * 3.5]);
  }
  const tg = new THREE.IcosahedronGeometry(1, 1), m4 = new THREE.Matrix4();
  trees.forEach((list, k) => {
    const im = new THREE.InstancedMesh(tg, litMat(tints[k]), list.length);
    list.forEach(([x, z, s], i) => { m4.makeScale(s, s * 1.15, s); m4.setPosition(x, s * 1.05, z); im.setMatrixAt(i, m4); });
    im.frustumCulled = false; scene.add(im);
  });
  for (let i = 0; i < 46; i++) { const x = (rnd() * 2 - 1) * 165, z = (rnd() * 2 - 1) * 210; if (Math.hypot(x, z) > 95) street.add(x, 4.5, z, 0.9, 0.95, 1.0, 2.6); }
  for (let z = 80; z <= 215; z += 22) for (const s of [-1, 1]) { street.add(11, 5, z * s, 1, 0.8, 0.5, 2.8); street.add(-11, 5, z * s, 1, 0.8, 0.5, 2.8); }

  // 増上寺ふうの大殿(東向き)・三解脱門・大門
  const bx = new THREE.BoxGeometry(1, 1, 1), pyr = new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4);
  const basic = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(r, g, b) });
  const put = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); scene.add(m); };
  const wall = basic(0.20, 0.115, 0.05), shoji = basic(0.95, 0.56, 0.22), shu = basic(0.30, 0.036, 0.012), shuDark = basic(0.10, 0.014, 0.006);
  const roof = litMat([0.010, 0.013, 0.015], 0.7), stone = litMat([0.020, 0.018, 0.016]);
  const K = 1 / 0.707;
  {
    const X = 95, Z = 45;
    put(bx, stone, X, 1.5, Z, 38, 3, 58); put(bx, stone, X + 22, 0.75, Z, 8, 1.5, 24);
    put(bx, wall, X, 8, Z, 30, 10, 46);
    put(bx, shoji, X + 15.1, 7.2, Z, 0.3, 6.4, 38);
    for (let i = -4; i <= 4; i++) put(bx, shuDark, X + 15.6, 8, Z + i * 5.2, 0.9, 10, 0.9);
    put(pyr, roof, X, 16.5, Z, 22 * K, 7, 31 * K);
    put(bx, wall, X, 19.5, Z, 20, 4, 32);
    put(pyr, roof, X, 28, Z, 15.5 * K, 13, 23 * K);
    for (let i = -3; i <= 3; i++) street.add(X + 19, 5.5, Z + i * 6, 1, 0.62, 0.26, 2.6);
    for (let x = 124; x <= 160; x += 7) for (const s of [-1, 1]) street.add(x, 2.1, Z + s * 8, 1, 0.55, 0.2, 1.7);   // 石灯籠
  }
  {
    const X = 168, Z = 45;   // 三解脱門
    for (const dz of [-9.5, -3.3, 3.3, 9.5]) put(bx, shu, X, 4.5, Z + dz, 7, 9, 2.6);
    put(bx, shu, X, 10.2, Z, 7.4, 2.4, 22);
    put(pyr, roof, X, 13.2, Z, 6.5 * K, 3.6, 14.5 * K);
    put(bx, shu, X, 16.6, Z, 6, 4.4, 18);
    put(pyr, roof, X, 22, Z, 6 * K, 6.5, 13 * K);
    for (const dz of [-12, -6.4, 0, 6.4, 12]) for (const dx of [-5, 5]) street.add(X + dx, 1.2, Z + dz, 1, 0.5, 0.2, 2.2);
  }
  {
    const X = 432, Z = 45;   // 大門
    for (const s of [-1, 1]) { put(bx, shu, X, 5, Z + s * 8, 2.2, 10, 2.2); put(bx, shu, X, 3.2, Z + s * 10.6, 1.6, 6.4, 1.6); street.add(X + 2, 1.5, Z + s * 8, 1, 0.5, 0.2, 2.4); street.add(X - 2, 1.5, Z + s * 8, 1, 0.5, 0.2, 2.4); }
    put(bx, shu, X, 10.6, Z, 2.6, 1.6, 23); put(pyr, roof, X, 12.7, Z, 3.4 * K, 2.6, 13.5 * K);
  }

  // 瓦屋根
  const rm = new THREE.InstancedMesh(pyr, litMat([0.008, 0.009, 0.011], 0.5), townRoofs.length);
  townRoofs.forEach(([x, z, w, d, h, rh], i) => { m4.makeScale(w * 0.56 * K, rh, d * 0.56 * K); m4.setPosition(x, h + rh / 2, z); rm.setMatrixAt(i, m4); });
  rm.frustumCulled = false; scene.add(rm);

  // 赤ちょうちん・街灯・自販機
  for (let x = 186; x < 894; x += 2.6) { if (Math.abs(x - 450) < 17 || Math.abs(x - 432) < 3) continue; for (const s of [-1, 1]) street.add(x, 3.3 + 0.2 * Math.sin(x * 0.8), 45 + s * 6.7, 1.5, 0.19, 0.04, 1.9); }
  for (let x = 196; x < 890; x += 22) for (const s of [-1, 1]) street.add(x + (s > 0 ? 11 : 0), 5.6, 45 + s * 7.3, 0.95, 0.58, 0.28, 2.6);
  for (const lx of [270, 360, 540, 630, 720, 810]) for (let k = 0; k < 13; k++) {
    const z0 = -215 + rnd() * 520, side = rnd() < 0.5 ? -1 : 1;
    if (Math.abs(z0 - 45) < 12) continue;
    for (let i = 0; i < 4; i++) street.add(lx + side * 6.5, 2.7, z0 + i * 1.1, 1.0, 0.13, 0.03, 1.2);
    street.add(lx - side * 6.5, 1.3, z0 + 8 + rnd() * 20, 0.7, 0.88, 1.0, 1.6);
  }
  for (const lz of [-135, -45, 135, 225]) for (let k = 0; k < 16; k++) {
    const x0 = 190 + rnd() * 700, side = rnd() < 0.5 ? -1 : 1;
    for (let i = 0; i < 3; i++) street.add(x0 + i * 1.1, 2.7, lz + side * 6.5, 1.0, 0.13, 0.03, 1.2);
  }
}

// ============================================================
// 歩く人・電車
// ============================================================
const life = [];
{
  const N = 300, peds = [];
  const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.46, 1.65, 0.3).translate(0, 0.825, 0), new THREE.MeshBasicMaterial(), N);
  const c = new THREE.Color(), m4 = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    const sando = i < 44, b = 0.012 + rnd() * 0.04;
    peds.push(sando ? { a0: 112, len: 54, lat: 45 + (rnd() * 2 - 1) * 5, s0: rnd() * 54, v: (0.7 + rnd() * 0.5) * (rnd() < 0.5 ? -1 : 1), ph: rnd() * 6 }
                    : { a0: 185, len: 705, lat: 45 + (rnd() < 0.5 ? -1 : 1) * (0.8 + rnd() * 5), s0: rnd() * 705, v: (0.9 + rnd() * 0.6) * (rnd() < 0.5 ? -1 : 1), ph: rnd() * 6 });
    pm.setColorAt(i, c.setRGB(b * (0.8 + rnd() * 0.6), b * (0.7 + rnd() * 0.5), b * (0.6 + rnd() * 0.8)));
  }
  pm.frustumCulled = false; scene.add(pm);
  life.push(t => { peds.forEach((p, i) => { m4.makeTranslation(p.a0 + mod(p.s0 + p.v * t, p.len), Math.abs(Math.sin(t * 5.5 + p.ph)) * 0.05, p.lat); pm.setMatrixAt(i, m4); }); pm.instanceMatrix.needsUpdate = true; });

  // 高架の線路と電車
  const TX = 990, CARS = 11, dark = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.014, 0.013, 0.013) });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(10, 1.2, 3900), dark); deck.position.set(TX, 9.4, -1350); scene.add(deck);
  const pil = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 9, 2), dark, 87); for (let i = 0; i < 87; i++) { m4.makeTranslation(TX, 4.5, -3290 + i * 45); pil.setMatrixAt(i, m4); } pil.frustumCulled = false; scene.add(pil);
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(2.9, 3.4, 19.3), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.035, 0.04, 0.045) }), CARS * 2);
  const win = new THREE.InstancedMesh(new THREE.BoxGeometry(3.0, 0.95, 17.4), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.95, 0.80, 0.52) }), CARS * 2);
  body.frustumCulled = win.frustumCulled = false; scene.add(body, win);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  life.push(t => {
    for (let k = 0; k < 2; k++) {
      const head = k === 0 ? -3300 + mod(900 + 23 * t, 4100) : 560 - mod(2300 + 23 * t, 4100), dir = k === 0 ? 1 : -1;
      for (let i = 0; i < CARS; i++) {
        const z = head - dir * i * 20, j = k * CARS + i;
        if (z > 548 || z < -3280) { body.setMatrixAt(j, zero); win.setMatrixAt(j, zero); continue; }
        m4.makeTranslation(TX + dir * 2.3, 11.8, z); body.setMatrixAt(j, m4);
        m4.makeTranslation(TX + dir * 2.3, 12.5, z); win.setMatrixAt(j, m4);
      }
    }
    body.instanceMatrix.needsUpdate = win.instanceMatrix.needsUpdate = true;
  });
}

// ============================================================
// 首都高・橋
// ============================================================
{
  const left = new V3(), lefts = hwLUT.map((p, i) => hwLeft(i / HW_N * hwLen, left).clone());
  function strip(fa, fb) {
    const pos = [], idx = [];
    for (let i = 0; i <= HW_N; i++) { const a = fa(hwLUT[i], lefts[i]), b = fb(hwLUT[i], lefts[i]); pos.push(a[0], a[1], a[2], b[0], b[1], b[2]); if (i < HW_N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
  }
  const HWW = 10;
  const deckMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.013, 0.011, 0.010), side: THREE.DoubleSide });
  const wallMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.016, 0.015, 0.0145), side: THREE.DoubleSide });
  const add = (g, m) => { const o = new THREE.Mesh(g, m); o.frustumCulled = false; scene.add(o); };
  add(strip((p, l) => [p.x + l.x * HWW, p.y, p.z + l.z * HWW], (p, l) => [p.x - l.x * HWW, p.y, p.z - l.z * HWW]), deckMat);
  add(strip((p, l) => [p.x + l.x * HWW, p.y - 2.2, p.z + l.z * HWW], (p, l) => [p.x - l.x * HWW, p.y - 2.2, p.z - l.z * HWW]), wallMat);
  for (const s of [1, -1]) add(strip((p, l) => [p.x + l.x * HWW * s, p.y - 2.2, p.z + l.z * HWW * s], (p, l) => [p.x + l.x * HWW * s, p.y + 1.1, p.z + l.z * HWW * s]), wallMat);

  // 橋脚と照明
  const step = hwLen / HW_N, pillars = [];
  for (let i = 0; i <= HW_N; i++) {
    const p = hwLUT[i], l = lefts[i], onBridge = i >= BR_A && i <= BR_B;
    if (i % 9 === 0 && !onBridge && isLand(p.x, p.z)) pillars.push([p.x, p.y - 2.2, p.z]);
    if (i % 8 === 0) for (const s of [1, -1]) street.add(p.x + l.x * (HWW + 0.5) * s, p.y + 9.5, p.z + l.z * (HWW + 0.5) * s, 1.0, 0.50, 0.13, 4.4);
  }
  const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0), wallMat, pillars.length), m4 = new THREE.Matrix4();
  pillars.forEach(([x, y, z], i) => { m4.makeScale(3.2, y + 1, 3.2); m4.setPosition(x, y, z); pm.setMatrixAt(i, m4); });
  pm.frustumCulled = false; scene.add(pm);

  // 吊り橋
  const towerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.17, 0.19, 0.23) });
  const span = BR_B - BR_A, iT1 = Math.round(BR_A + span * 0.25), iT2 = Math.round(BR_A + span * 0.75);
  for (const it of [iT1, iT2]) {
    const p = hwLUT[it], l = lefts[it], ang = Math.atan2(l.x, l.z);
    for (const s of [1, -1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(5, 132, 6), towerMat); m.position.set(p.x + l.x * 12.5 * s, 64, p.z + l.z * 12.5 * s); m.rotation.y = ang; scene.add(m); street.add(p.x + l.x * 12.5 * s, 133, p.z + l.z * 12.5 * s, 1, 0.05, 0.03, 5, 1, 0.3); }
    for (const y of [38, 92, 126]) { const m = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 25), towerMat); m.position.set(p.x, y, p.z); m.rotation.y = ang; scene.add(m); }
  }
  const cableY = f => f < 0.25 ? 52 + 76 * Math.pow(f / 0.25, 1.6) : (f > 0.75 ? 52 + 76 * Math.pow((1 - f) / 0.25, 1.6) : 128 - 68 * (1 - ((f - 0.5) / 0.25) ** 2));
  const hang = [];
  for (let i = BR_A; i <= BR_B; i++) {
    const p = hwLUT[i], l = lefts[i], f = (i - BR_A) / span, y = cableY(f);
    for (const s of [1, -1]) {
      const x = p.x + l.x * 12.5 * s, z = p.z + l.z * 12.5 * s;
      if (i % 2 === 0) street.add(x, y, z, 0.80, 0.90, 1.0, 3.6);
      if (i % 4 === 0) { hang.push(x, y, z, x, p.y, z); street.add(x, p.y + 1.5, z, 0.6, 0.8, 1.0, 2.4); }
    }
  }
  const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(hang, 3));
  const hl = new THREE.LineSegments(hg, new THREE.LineBasicMaterial({ color: new THREE.Color().setRGB(0.04, 0.05, 0.07) })); hl.frustumCulled = false; scene.add(hl);
}

// ============================================================
// 街灯・遠くの街明かり
// ============================================================
{
  const ok = (x, z) => isLand(x, z) && !inPark(x, z) && Math.hypot(x, z) < CITY_R;
  for (let k = -7; k <= 7; k++) for (let s = -3200; s <= 3200; s += 36) for (const o of [-14.5, 14.5]) {
    let x = 450 * k + o, z = s; if (ok(x, z)) street.add(x, 9.5, z, 0.85, 0.60, 0.33, 3.6);
    x = s; z = 225 + 450 * k + o; if (ok(x, z)) street.add(x, 9.5, z, 0.85, 0.60, 0.33, 3.6);
  }
  for (let i = -36; i <= 36; i++) for (let j = -37; j <= 36; j++) { const x = 90 * i + 5, z = 45 + 90 * j + 5; if (ok(x, z)) street.add(x, 7, z, 0.36, 0.40, 0.46, 2.6); }
  scene.add(street.build(1));

  const far = new LightSet();
  for (let i = 0; i < 60000; i++) {
    const r = 3050 + Math.pow(rnd(), 1.6) * 7500, a = rnd() * Math.PI * 2, x = r * Math.cos(a), z = r * Math.sin(a), d = bayD(x, z);
    if (!(d < 1050 || d > 5200)) continue;
    const t = rnd(), b = 0.22 + rnd() * 0.38;
    const c = t < 0.55 ? [1, 0.72, 0.42] : t < 0.9 ? [0.95, 0.95, 1] : t < 0.95 ? [1, 0.15, 0.1] : [0.3, 0.9, 1];
    const tall = rnd() < 0.012;
    if (tall) far.add(x, 90 + rnd() * 130, z, 1, 0.05, 0.03, 14, 1, rnd());
    else far.add(x, 4 + rnd() * rnd() * 70, z, c[0] * b, c[1] * b, c[2] * b, 9 + rnd() * 8);
  }
  scene.add(far.build(0.5));
}

// ============================================================
// 車の流れ
// ============================================================
const cars = [];
let carPoints, carPos;
{
  const ls = new LightSet(), L = 6800;
  const push = c => { cars.push(c); ls.add(0, -500, 0, 1.2, 1.08, 0.85, 2.6); ls.add(0, -500, 0, 1.1, 0.05, 0.02, 2.4); };
  for (let k = -7; k <= 7; k++) for (const axis of [0, 1]) for (const dir of [1, -1]) for (const off of [3.2, 7.6]) {
    const base = axis === 0 ? 450 * k : 225 + 450 * k;
    let s = rnd() * 40;
    while (s < L) { push({ type: axis, base, lat: off * dir * (axis === 0 ? 1 : -1), dir, s0: s, v: 11 + rnd() * 6 }); s += 18 + rnd() * rnd() * 110; }
  }
  for (const dir of [1, -1]) for (const off of [2.8, 6.6]) {
    let s = rnd() * 30;
    while (s < hwLen) { push({ type: 2, lat: off * dir, dir, s0: s, v: 21 + rnd() * 6 }); s += 22 + rnd() * rnd() * 90; }
  }
  carPoints = ls.build(1); carPos = carPoints.geometry.attributes.position;
  carPos.setUsage(THREE.DynamicDrawUsage);
  scene.add(carPoints);
  const p = new V3(), l = new V3(), L2 = L / 2;
  window.__cars = cars.length;
  carPoints.userData.update = t => {
    const a = carPos.array;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i], o = i * 6;
      if (c.type === 2) {
        const s = mod(c.s0 + c.v * c.dir * t, hwLen);
        hwAt(s, p); hwLeft(s, l);
        const fx = -l.z * c.dir, fz = l.x * c.dir, x = p.x + l.x * c.lat, z = p.z + l.z * c.lat, y = p.y + 1.1;
        a[o] = x + fx * 2.2; a[o + 1] = y; a[o + 2] = z + fz * 2.2; a[o + 3] = x - fx * 2.2; a[o + 4] = y; a[o + 5] = z - fz * 2.2;
      } else {
        const s = mod(c.s0 + c.v * c.dir * t, L) - L2;
        const x = c.type === 0 ? c.base + c.lat : s, z = c.type === 0 ? s : c.base + c.lat;
        if (!isLand(x, z) || inPark(x, z) || x * x + z * z > CITY_R * CITY_R) { a[o + 1] = a[o + 4] = -500; continue; }
        const fx = c.type === 0 ? 0 : c.dir * 2.2, fz = c.type === 0 ? c.dir * 2.2 : 0;
        a[o] = x + fx; a[o + 1] = 1.1; a[o + 2] = z + fz; a[o + 3] = x - fx; a[o + 4] = 1.1; a[o + 5] = z - fz;
      }
    }
    carPos.needsUpdate = true;
  };
}

// ============================================================
// 海
// ============================================================
let water;
{
  const N = 256, data = new Uint8Array(N * N * 4), hgt = new Float32Array(N * N), waves = [];
  for (let i = 0; i < 26; i++) { const kx = Math.round((rnd() * 2 - 1) * 14), ky = Math.round((rnd() * 2 - 1) * 14), k = Math.hypot(kx, ky) || 1; waves.push([kx, ky, rnd() * 6.28, 1 / Math.pow(k, 1.1)]); }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let h = 0; for (const [kx, ky, ph, am] of waves) h += am * Math.sin((kx * x + ky * y) / N * 6.2831853 + ph); hgt[y * N + x] = h; }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const hx = hgt[y * N + (x + 1) % N] - hgt[y * N + (x + N - 1) % N], hy = hgt[((y + 1) % N) * N + x] - hgt[((y + N - 1) % N) * N + x];
    const n = new V3(-hx * 1.6, -hy * 1.6, 1).normalize(), o = (y * N + x) * 4;
    data[o] = (n.x * 0.5 + 0.5) * 255; data[o + 1] = (n.y * 0.5 + 0.5) * 255; data[o + 2] = (n.z * 0.5 + 0.5) * 255; data[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
  water = new Water(new THREE.PlaneGeometry(40000, 40000), {
    textureWidth: 1024, textureHeight: 1024, waterNormals: tex, sunDirection: MOON_DIR.clone(),
    sunColor: new THREE.Color().setRGB(0.30, 0.33, 0.42), waterColor: new THREE.Color().setRGB(0.0, 0.012, 0.024), distortionScale: 3.0, fog: false,
  });
  water.rotation.x = -Math.PI / 2; water.position.y = -0.6;
  water.material.uniforms.size.value = 3.0;
  water.frustumCulled = false; scene.add(water);
}

// ============================================================
// 仕上げ(光のにじみ・周辺減光・粒子)
// ============================================================
const pr = renderer.getPixelRatio();
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(W * pr, H * pr, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W * pr, H * pr), 0.42, 0.5, 0.62);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const finalPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uFade: { value: 1 }, uTime: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uFade, uTime; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q) * 0.85;
      float n = fract(sin(dot(gl_FragCoord.xy + uTime * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * (2.0 / 255.0);
      gl_FragColor = vec4(c * uFade, 1.0);
    }`,
});
composer.addPass(finalPass);

// ============================================================
// カメラワーク(6カット・60秒)
// ============================================================
const tgt = new V3(), tmpP = new V3(), tmpL = new V3(), tmpA = new V3();
const cam = (px, py, pz, tx, ty, tz, fov) => { camera.position.set(px, py, pz); tgt.set(tx, ty, tz); camera.fov = fov; };
const HW_S0 = nearestHwIndex(-640, -400) / HW_N * hwLen;
const bayXZ = (d, p) => [d * 0.5 + p * 0.866, d * 0.866 - p * 0.5];
const SHOTS = [
  // 1. 大通りからタワーへ。暗い街に灯がともる
  { t0: 0, t1: 8, f: u => { const e = u * (0.55 + 0.45 * u); cam(lerp(-5, -3, u), lerp(36, 17, smooth(u)), lerp(-1380, -720, e), 0, lerp(120, 182, smooth(u)), 0, 42); } },
  // 2. 足もとから見上げ、らせんを描いて大展望台へ
  { t0: 8, t1: 17, f: u => { const a = lerp(-2.5, 0.9, smooth(u) * 0.75 + u * 0.25), r = lerp(150, 112, u), y = lerp(16, 196, Math.pow(u, 1.25)); cam(Math.cos(a) * r, y, Math.sin(a) * r, 0, lerp(118, 172, smooth(u)), 0, 50); } },
  // 3. 大門の通りを歩く目線で。ちょうちんの並ぶ町から門をくぐり、寺とタワーへ
  { t0: 17, t1: 27, f: u => { const e = u * (0.7 + 0.3 * u); cam(lerp(585, 238, e), lerp(8, 5.2, smooth(u)), 45 + lerp(1.5, -1.5, u), 0, lerp(92, 118, smooth(u)), 20, 52); } },
  // 4. 境内から。大殿の屋根ごしに見上げるタワー
  { t0: 27, t1: 36, f: u => { const e = smooth(u); cam(lerp(162, 157, e), lerp(2.8, 12, e), lerp(50, 62, e), lerp(70, 40, e), lerp(40, 84, e), lerp(42, 20, e), 58); } },
  // 5. 上空を旋回。湾と橋と月を背に
  { t0: 36, t1: 44, f: u => { const a = lerp(3.5, 4.25, u), r = lerp(860, 790, u); cam(Math.cos(a) * r, lerp(330, 280, u), Math.sin(a) * r, 60, 135, 90, 36); } },
  // 6. 湾の水面すれすれから
  { t0: 44, t1: 52, f: u => { const [x, z] = bayXZ(lerp(1850, 1500, u), lerp(760, 610, u)); cam(x, lerp(7, 28, smooth(u)), z, 0, lerp(150, 165, u), 0, 32); } },
  // 7. きらめくタワーから引いていくフィナーレ
  { t0: 52, t1: 60, f: u => { const e = smooth(u * 0.9); cam(lerp(420, 760, e), lerp(240, 520, e), lerp(620, 1060, e), 0, lerp(160, 135, e), 0, 40); } },
];
const titleEl = document.getElementById('title');

function renderFrame(t) {
  t = Math.min(Math.max(t, 0), DURATION);
  U.time.value = t;
  const L = t < 2 ? 0 : 365 * smooth((t - 2) / 2.8);
  U.lit.value = L; U.glow.value = clamp01(L / 333);
  U.sparkle.value = smooth((t - 53.2) / 1.5);
  for (const d of towerDyn) d.mat.color.lerpColors(d.off, d.on, clamp01((L - d.y) / 18));
  carPoints.userData.update(t);
  for (const f of life) f(t);
  water.material.uniforms.time.value = t * 0.55;

  let shot = SHOTS[SHOTS.length - 1];
  for (const s of SHOTS) if (t >= s.t0 && t < s.t1) { shot = s; break; }
  shot.f(clamp01((t - shot.t0) / (shot.t1 - shot.t0)));
  camera.lookAt(tgt); camera.updateProjectionMatrix();
  U.scale.value = H * renderer.getPixelRatio() / (2 * Math.tan(camera.fov * Math.PI / 360));

  // 暗転(はじめ・終わり・カットの切れ目)
  let fade = smooth(t / 1.6) * (1 - smooth((t - 58.2) / 1.7));
  for (const s of SHOTS) if (s.t0 > 0) fade *= smooth(Math.abs(t - s.t0) / 0.32);
  finalPass.uniforms.uFade.value = fade; finalPass.uniforms.uTime.value = t;
  titleEl.style.opacity = (smooth((t - 4.2) / 1.2) * (1 - smooth((t - 6.7) / 0.9))).toFixed(3);
  composer.render();
}
window.renderFrame = renderFrame;
window.__gpu = (() => { const gl = renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; })();

if (CAPTURE) {
  renderFrame(0);
  window.__ready = true;
} else {
  // プレビュー: 画面に合わせて縮小して、60秒をくり返し再生(?t=秒 で静止)
  const stage = document.getElementById('stage');
  const fit = () => { const s = Math.min(innerWidth / W, innerHeight / H); stage.style.transform = `translate(${(innerWidth - W * s) / 2}px, ${(innerHeight - H * s) / 2}px) scale(${s})`; };
  addEventListener('resize', fit); fit();
  const fixed = params.has('t') ? parseFloat(params.get('t')) : null, t0 = performance.now();
  const loop = () => { renderFrame(fixed ?? ((performance.now() - t0) / 1000) % DURATION); requestAnimationFrame(loop); };
  loop();
}
