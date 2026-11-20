// The 3D model card's renderer (ticket 42): a tiny ray-marcher over signed distance fields,
// one ray per dot, Lambert light from the upper left. Pure, no canvas.
import { expect, test } from "bun:test";
import { modelSdf, projectPoint, renderModel, type ModelSpec } from "../app/src/model3d.ts";

const at = (img: Float32Array, cols: number, x: number, y: number) => img[y * cols + x]!;
const lit = (img: Float32Array) => img.filter((v) => v > 0).length;

test("a sphere fills the middle, leaves the corners empty, and is lit from the upper left", () => {
  const img = renderModel(modelSdf({ shape: "sphere" }), 40, 40, 0, 0);
  expect(at(img, 40, 20, 20)).toBeGreaterThan(0);
  expect(at(img, 40, 0, 0)).toBe(0);
  expect(at(img, 40, 39, 39)).toBe(0);
  expect(at(img, 40, 12, 12)).toBeGreaterThan(at(img, 40, 28, 28));
  // Even the shadow side keeps a deep teal dot (never dropped inside the silhouette).
  expect(at(img, 40, 28, 28)).toBeGreaterThan(0.2);
});

test("turning changes what a cube shows; a sphere looks the same", () => {
  const cube = modelSdf({ shape: "cube" });
  expect([...renderModel(cube, 30, 30, 0, 0.3)]).not.toEqual([...renderModel(cube, 30, 30, 0.6, 0.3)]);
  const sphere = modelSdf({ shape: "sphere" });
  expect(lit(renderModel(sphere, 30, 30, 0, 0.3))).toBe(lit(renderModel(sphere, 30, 30, 0.6, 0.3)));
});

test("every shape draws something", () => {
  const specs: ModelSpec[] = [
    { shape: "planet" }, { shape: "torus" }, { shape: "cell" },
    { shape: "molecule", atoms: [{ x: 0, y: 0, z: 0, r: 0.4 }, { x: 1, y: 1, z: 1 }], bonds: [{ a: 1, b: 2 }] },
    { shape: "points", points: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }] },
    { shape: "heightmap", heights: [0, 0.5, 0.5, 1] },
  ];
  for (const s of specs) expect(lit(renderModel(modelSdf(s), 40, 30, 0.4, 0.35))).toBeGreaterThan(10);
});

test("a planet's ring is wider than its ball", () => {
  const w = (img: Float32Array) => {
    let lo = 99, hi = -1;
    for (let y = 0; y < 40; y++) for (let x = 0; x < 60; x++) if (at(img, 60, x, y) > 0) (lo = Math.min(lo, x)), (hi = Math.max(hi, x));
    return hi - lo;
  };
  expect(w(renderModel(modelSdf({ shape: "planet" }), 60, 40, 0, 0.3))).toBeGreaterThan(w(renderModel(modelSdf({ shape: "sphere" }), 60, 40, 0, 0.3)));
});

test("labels are pinned to a 3D point: the centre stays put, a point on the right swings round as it turns", () => {
  expect(projectPoint({ x: 0, y: 0, z: 0 }, 1, 0.3, 40, 30)).toEqual({ x: 20, y: 15, front: true });
  const a = projectPoint({ x: 0.8, y: 0, z: 0 }, 0, 0, 40, 30);
  const b = projectPoint({ x: 0.8, y: 0, z: 0 }, Math.PI / 2, 0, 40, 30);
  expect(a.x).toBeGreaterThan(10);
  expect(Math.abs(b.x - 20)).toBeLessThan(0.5);
  // Up in the model is up on screen (smaller y).
  expect(projectPoint({ x: 0, y: 0.8, z: 0 }, 0, 0, 40, 30).y).toBeLessThan(15);
});
