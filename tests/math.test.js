import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_DEGREE,
  curvature,
  evaluate,
  joinPair,
  lowerDegree,
  raiseDegree,
  sampleAdaptive,
  split,
  tangent,
} from '../src/math.js';

const cubic = [
  { x: 0, y: 0 },
  { x: 1, y: 3 },
  { x: 4, y: 3 },
  { x: 5, y: 0 },
];

test('de Casteljau evaluation and endpoint interpolation', () => {
  assert.deepEqual(evaluate(cubic, 0), cubic[0]);
  assert.deepEqual(evaluate(cubic, 1), cubic.at(-1));
  assert.deepEqual(evaluate(cubic, 0.5), { x: 2.5, y: 2.25 });
});

test('tangent at endpoints follows first and last legs', () => {
  assert.deepEqual(tangent(cubic, 0), normalize({ x: 1, y: 3 }));
  assert.deepEqual(tangent(cubic, 1), normalize({ x: 1, y: -3 }));
});

test('quadratic curvature matches the analytic semicircle-like parabola', () => {
  const parabola = [
    { x: 0, y: 0 },
    { x: 0.5, y: 1 },
    { x: 1, y: 0 },
  ];
  const info = curvature(parabola, 0.5);
  assert.ok(Math.abs(info.value - 4) < 1e-12);
  assert.ok(Math.abs(info.radius - 0.25) < 1e-12);
  assert.ok(info.signed < 0);
});

test('line has zero curvature and finite fallback tangent', () => {
  const line = [
    { x: 2, y: 2 },
    { x: 8, y: -1 },
  ];
  assert.equal(curvature(line, 0.5).value, 0);
  assert.deepEqual(tangent(line, 0.5), normalize({ x: 6, y: -3 }));
});

test('degree elevation preserves geometry and adds one control point', () => {
  const raised = raiseDegree(cubic);
  assert.equal(raised.length, cubic.length + 1);
  for (let i = 0; i <= 100; i += 1) {
    const t = i / 100;
    const a = evaluate(cubic, t);
    const b = evaluate(raised, t);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-10);
  }
});

test('lowering an exactly elevated curve is exact', () => {
  const raised = raiseDegree(cubic);
  const result = lowerDegree(raised);
  assert.equal(result.points.length, cubic.length);
  assert.ok(result.exact);
  assert.ok(result.error < 1e-8);
  result.points.forEach((point, index) => {
    assert.ok(Math.abs(point.x - cubic[index].x) < 1e-8);
    assert.ok(Math.abs(point.y - cubic[index].y) < 1e-8);
  });
});

test('approximate degree reduction reports bounded non-zero error', () => {
  const result = lowerDegree(cubic);
  assert.equal(result.points.length, 3);
  assert.equal(result.exact, false);
  assert.ok(result.error > 1e-8);
  for (let i = 0; i <= 20; i += 1) {
    const t = i / 20;
    const distance = Math.hypot(
      evaluate(cubic, t).x - evaluate(result.points, t).x,
      evaluate(cubic, t).y - evaluate(result.points, t).y,
    );
    assert.ok(distance < 0.2);
  }
});

test('split at t and exact join reconstruct the original curve', () => {
  const parts = split(cubic, 0.37);
  assert.equal(parts.left.length, 4);
  assert.equal(parts.right.length, 4);
  assert.deepEqual(parts.point, evaluate(cubic, 0.37));

  for (let i = 0; i <= 20; i += 1) {
    const t = i / 20;
    const source = t <= 0.37
      ? evaluate(parts.left, t / 0.37)
      : evaluate(parts.right, (t - 0.37) / 0.63);
    const expected = evaluate(cubic, t);
    assert.ok(Math.hypot(source.x - expected.x, source.y - expected.y) < 1e-9);
  }

  const joined = joinPair(parts.left, parts.right, 0.37);
  assert.ok(joined.exact);
  assert.ok(joined.error < 1e-8);
  joined.points.forEach((point, index) => {
    assert.ok(Math.abs(point.x - cubic[index].x) < 1e-8);
    assert.ok(Math.abs(point.y - cubic[index].y) < 1e-8);
  });
});

test('adaptive sampler keeps endpoints and stays bounded', () => {
  const points = sampleAdaptive(cubic, 0.5, 18);
  assert.ok(points.length >= 3);
  assert.ok(points.length <= 2 ** 18 + 1);
  assert.deepEqual(points[0], cubic[0]);
  assert.deepEqual(points.at(-1), cubic.at(-1));
});

test('maximum degree operations do not collapse numerical solving', () => {
  const points = Array.from({ length: MAX_DEGREE + 1 }, (_, index) => ({
    x: index * 37.3,
    y: Math.sin(index / 2) * 80,
  }));
  assert.deepEqual(evaluate(points, 0), points[0]);
  assert.deepEqual(evaluate(points, 1), points.at(-1));
  const parts = split(points, 0.618);
  assert.equal(parts.left.length, MAX_DEGREE + 1);
  const joined = joinPair(parts.left, parts.right, 0.618);
  assert.equal(joined.points.length, MAX_DEGREE + 1);
  assert.ok(joined.error < 1e-7);
});

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y);
  return { x: vector.x / length, y: vector.y / length };
}
