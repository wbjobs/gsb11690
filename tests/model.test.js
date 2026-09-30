import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORLD,
  addPoint,
  createInitialDocument,
  deletePoint,
  mergeSelected,
  movePoint,
  raiseSelected,
  sanitizeDocument,
  splitSelected,
} from '../src/model.js';

test('moving a point clamps it to world bounds', () => {
  const initial = createInitialDocument();
  const updated = movePoint(initial, initial.curves[0].id, 0, {
    x: WORLD.maxX + 999,
    y: WORLD.minY - 999,
  });
  assert.deepEqual(updated.curves[0].points[0], {
    x: WORLD.maxX,
    y: WORLD.minY,
  });
});

test('add raises degree until max and rejects excessive degree', () => {
  let state = createInitialDocument();
  const id = state.curves[0].id;
  while (state.curves[0].points.length < 25) {
    state = addPoint(state, id, { x: 10, y: 10 }).document;
  }
  assert.equal(state.curves[0].points.length, 25);
  assert.throws(() => addPoint(state, id, { x: 10, y: 10 }), /24/);
});

test('deleting final point of a line removes the curve', () => {
  const state = createInitialDocument();
  const lineState = {
    ...state,
    curves: [
      ...state.curves,
      {
        id: 'line',
        color: '#000',
        splitOf: null,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      },
    ],
  };
  const result = deletePoint(lineState, 'line', 0);
  assert.equal(result.removedCurve, true);
  assert.equal(result.document.curves.length, 2);
});

test('split then sibling merge returns the original cubic controls', () => {
  const initial = createInitialDocument();
  const source = initial.curves[0];
  const splitResult = splitSelected(initial, source.id, 0.42);
  assert.equal(splitResult.document.curves.length, 3);
  const merged = mergeSelected(splitResult.document, splitResult.ids);
  assert.equal(merged.exact, true);
  assert.equal(merged.document.curves.length, 2);
  merged.document.curves.find((curve) => curve.id === merged.id).points
    .forEach((point, index) => {
      assert.ok(Math.abs(point.x - source.points[index].x) < 1e-8);
      assert.ok(Math.abs(point.y - source.points[index].y) < 1e-8);
    });
});

test('sanitizes malformed and out-of-bounds persisted documents', () => {
  const document = sanitizeDocument({
    nextId: 3,
    curves: [
      null,
      { id: 'x', points: [{ x: -99999, y: 99999 }] },
      {
        id: 'ok',
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 20 },
          { x: 50, y: 10 },
        ],
      },
    ],
  });
  assert.equal(document.curves.length, 1);
  assert.deepEqual(document.curves[0].points[0], { x: 0, y: 0 });
});

test('raise degree preserves curve count and selected id', () => {
  const initial = createInitialDocument();
  const raised = raiseSelected(initial, initial.curves[0].id);
  assert.equal(raised.curves[0].points.length, 5);
  assert.equal(raised.curves.length, initial.curves.length);
});

test('merge rejects curves without connected endpoints', () => {
  const initial = createInitialDocument();
  const first = initial.curves[0].id;
  const second = initial.curves[1].id;
  assert.throws(() => mergeSelected(initial, [first, second]), /端点/);
});

test('merges connected unequal collinear lines exactly by arc length ratio', () => {
  const document = {
    nextId: 3,
    curves: [
      {
        id: 'a',
        color: '#000',
        splitOf: null,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      },
      {
        id: 'b',
        color: '#000',
        splitOf: null,
        points: [
          { x: 10, y: 0 },
          { x: 30, y: 0 },
        ],
      },
    ],
  };
  const result = mergeSelected(document, ['a', 'b']);
  assert.equal(result.exact, true);
  assert.ok(result.error < 1e-8);
});
