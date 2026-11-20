// The 3D model card's renderer (ticket 42): a tiny ray-marcher, no 3D library. Each shape is a
// signed distance field in model space (-1..1); one orthographic ray per dot finds the surface,
// and Lambert light from the upper left gives each dot a brightness for the dither (dither.ts).
// At ~80 x 60 dots that is a few thousand rays a frame: cheap enough to turn at 24 fps.
// Idea from Roamies (AGPL): idea only, no code.
import type { ModelShape } from "../../src/core/card-kinds.ts";

type V3 = { x: number; y: number; z: number };
export interface ModelSpec {
  shape: ModelShape;
  atoms?: (V3 & { r?: number; label?: string })[];
  bonds?: { a: number; b: number }[];
  points?: V3[];
  heights?: number[];
  labels?: (V3 & { text: string })[];
}
export type Sdf = (x: number, y: number, z: number) => number;

/** How much of the view the model space -1..1 takes: a little air around it. */
const VIEW = 1.0;
const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);

/** Molecules and point clouds: centred and shrunk to fit (radius 0.9) if they spill out. */
function fit(ps: (V3 & { r?: number })[], pad: number): (p: V3) => V3 {
  const lo = { x: Infinity, y: Infinity, z: Infinity }, hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of ps) for (const k of ["x", "y", "z"] as const) (lo[k] = Math.min(lo[k], p[k])), (hi[k] = Math.max(hi[k], p[k]));
  const c = { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2, z: (lo.z + hi.z) / 2 };
  const reach = Math.max(...ps.map((p) => len3(p.x - c.x, p.y - c.y, p.z - c.z) + (p.r ?? pad)), 1e-6);
  const s = Math.min(1.6, 0.9 / reach);
  return (p) => ({ x: (p.x - c.x) * s, y: (p.y - c.y) * s, z: (p.z - c.z) * s });
}

const ATOM_R = 0.22;
const scaleOf = (ps: (V3 & { r?: number })[], pad: number) => {
  const f = fit(ps, pad);
  const a = f({ x: 0, y: 0, z: 0 }), b = f({ x: 1, y: 0, z: 0 });
  return { f, s: b.x - a.x };
};

/** The distance field for a shape. */
export function modelSdf(m: ModelSpec): Sdf {
  switch (m.shape) {
    case "sphere":
      return (x, y, z) => len3(x, y, z) - 0.72;
    case "planet":
      // A ball and a flat ring round it (a black hole's disk, Saturn), tilted a little.
      return (x, y, z) => {
        const ty = y * 0.97 - x * 0.24, tx = x * 0.97 + y * 0.24;
        const ball = len3(x, y, z) - 0.56;
        const ring = Math.max(Math.abs(Math.hypot(tx, z) - 0.8) - 0.14, Math.abs(ty) - 0.05);
        return Math.min(ball, ring);
      };
    case "torus":
      return (x, y, z) => Math.hypot(Math.hypot(x, z) - 0.58, y) - 0.24;
    case "cube":
      return (x, y, z) => {
        const qx = Math.abs(x) - 0.48, qy = Math.abs(y) - 0.48, qz = Math.abs(z) - 0.48;
        return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - 0.04;
      };
    case "cell":
      // A soft, squashed blob with a wobbly skin.
      return (x, y, z) => (len3(x, y * 1.25, z) - 0.7 + 0.05 * Math.sin(5 * x) * Math.sin(4 * y + 1) * Math.sin(5 * z + 2)) * 0.7;
    case "molecule": {
      const atoms = m.atoms ?? [];
      if (!atoms.length) return () => 1;
      const { f, s } = scaleOf(atoms, ATOM_R);
      const balls = atoms.map((a) => ({ ...f(a), r: (a.r ?? ATOM_R) * s }));
      const sticks = (m.bonds ?? []).map((b) => [balls[b.a - 1], balls[b.b - 1]] as const).filter(([a, b]) => a && b);
      return (x, y, z) => {
        let d = Infinity;
        for (const b of balls) d = Math.min(d, len3(x - b.x, y - b.y, z - b.z) - b.r);
        for (const [a, b] of sticks) {
          // A capsule from a to b.
          const bx = b!.x - a!.x, by = b!.y - a!.y, bz = b!.z - a!.z;
          const px = x - a!.x, py = y - a!.y, pz = z - a!.z;
          const h = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz || 1)));
          d = Math.min(d, len3(px - bx * h, py - by * h, pz - bz * h) - 0.05 * s);
        }
        return d;
      };
    }
    case "points": {
      const ps = m.points ?? [];
      if (!ps.length) return () => 1;
      const { f } = scaleOf(ps, 0.13);
      const dots = ps.map(f);
      return (x, y, z) => {
        let d = Infinity;
        for (const p of dots) d = Math.min(d, len3(x - p.x, y - p.y, z - p.z) - 0.08);
        return d;
      };
    }
    case "heightmap": {
      const hs = m.heights ?? [];
      const n = Math.round(Math.sqrt(hs.length));
      if (n < 2) return () => 1;
      const E = 0.8, BOTTOM = -0.35;
      // Bilinear height at x, z in -E..E.
      const height = (x: number, z: number) => {
        const u = Math.max(0, Math.min(n - 1, ((x + E) / (2 * E)) * (n - 1)));
        const v = Math.max(0, Math.min(n - 1, ((z + E) / (2 * E)) * (n - 1)));
        const i = Math.min(n - 2, Math.floor(u)), j = Math.min(n - 2, Math.floor(v));
        const fu = u - i, fv = v - j;
        const h = (a: number, b: number) => hs[b * n + a]!;
        const top = h(i, j) * (1 - fu) + h(i + 1, j) * fu, bot = h(i, j + 1) * (1 - fu) + h(i + 1, j + 1) * fu;
        return BOTTOM + 0.1 + (top * (1 - fv) + bot * fv) * 0.6;
      };
      return (x, y, z) => {
        const box = Math.max(Math.abs(x) - E, Math.abs(z) - E, BOTTOM - y);
        return Math.max(box, (y - height(x, z)) * 0.5);
      };
    }
  }
}

/** Model space -> view space: turn (yaw, round the vertical axis), then tip towards the viewer (pitch). */
function toView(p: V3, yaw: number, pitch: number): V3 {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x = p.x * cy + p.z * sy, z1 = -p.x * sy + p.z * cy;
  return { x, y: p.y * cp - z1 * sp, z: p.y * sp + z1 * cp };
}
function toModel(p: V3, yaw: number, pitch: number): V3 {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const y = p.y * cp + p.z * sp, z1 = -p.y * sp + p.z * cp;
  return { x: p.x * cy - z1 * sy, y, z: p.x * sy + z1 * cy };
}

/** Light from the upper left, a little in front (view space; the camera looks along +z). */
const LIGHT = (() => {
  const l = { x: -0.55, y: 0.6, z: -0.58 };
  const n = len3(l.x, l.y, l.z);
  return { x: l.x / n, y: l.y / n, z: l.z / n };
})();

/**
 * One brightness per dot (cols x rows, row by row): 0 = no surface, else 0.22 (shadow, deep
 * teal) to 1 (lit, near white).
 */
export function renderModel(sdf: Sdf, cols: number, rows: number, yaw: number, pitch: number): Float32Array {
  const out = new Float32Array(cols * rows);
  const k = (2 * VIEW) / Math.min(cols, rows);
  const dir = toModel({ x: 0, y: 0, z: 1 }, yaw, pitch);
  const light = toModel(LIGHT, yaw, pitch);
  const e = 0.004;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const u = (i + 0.5 - cols / 2) * k, v = (rows / 2 - j - 0.5) * k;
      if (u * u + v * v > 1.45 * 1.45) continue; // outside the bounding ball
      const o = toModel({ x: u, y: v, z: -1.6 }, yaw, pitch);
      let t = 0;
      let hit = false;
      for (let s = 0; s < 56 && t < 3.2; s++) {
        const d = sdf(o.x + dir.x * t, o.y + dir.y * t, o.z + dir.z * t);
        if (d < 0.003) {
          hit = true;
          break;
        }
        t += d;
      }
      if (!hit) continue;
      const px = o.x + dir.x * t, py = o.y + dir.y * t, pz = o.z + dir.z * t;
      // Normal from four taps (the tetrahedron trick).
      const a = sdf(px + e, py - e, pz - e), b = sdf(px - e, py - e, pz + e), c = sdf(px - e, py + e, pz - e), d = sdf(px + e, py + e, pz + e);
      const nx = a - b - c + d, ny = -a - b + c + d, nz = -a + b - c + d;
      const nl = len3(nx, ny, nz) || 1;
      const lambert = Math.max(0, (nx * light.x + ny * light.y + nz * light.z) / nl);
      out[j * cols + i] = 0.22 + 0.78 * lambert;
    }
  return out;
}

/** Where a model-space point lands on the dot grid (cell units, y down); `front`: on the near half. */
export function projectPoint(p: V3, yaw: number, pitch: number, cols: number, rows: number): { x: number; y: number; front: boolean } {
  const v = toView(p, yaw, pitch);
  const k = Math.min(cols, rows) / (2 * VIEW);
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return { x: r(cols / 2 + v.x * k), y: r(rows / 2 - v.y * k), front: v.z <= 0.05 };
}

/** Every label to pin: the card's own, then each atom's (molecules move to fit, so their labels do too). */
export function modelLabels(m: ModelSpec): (V3 & { text: string })[] {
  const out = [...(m.labels ?? [])];
  if (m.shape === "molecule" && m.atoms?.length) {
    const { f } = scaleOf(m.atoms, ATOM_R);
    for (const a of m.atoms) if (a.label) out.push({ ...f(a), text: a.label });
  }
  return out;
}
