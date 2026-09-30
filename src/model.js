import {
  MAX_DEGREE,
  clampPoint,
  evaluate,
  isInside,
  joinPair,
  lowerDegree,
  raiseDegree,
  split,
} from './math.js';

export const WORLD = Object.freeze({
  minX: -200,
  minY: -150,
  maxX: 1800,
  maxY: 1150,
});

const PALETTE = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed'];

export function createInitialDocument() {
  return {
    nextId: 5,
    curves: [
      {
        id: 'curve-1',
        points: [
          { x: 180, y: 300 },
          { x: 380, y: 100 },
          { x: 680, y: 520 },
          { x: 920, y: 260 },
        ],
        splitOf: null,
        color: PALETTE[0],
      },
      {
        id: 'curve-2',
        points: [
          { x: 1020, y: 560 },
          { x: 1220, y: 160 },
          { x: 1440, y: 460 },
        ],
        color: PALETTE[1],
      },
    ],
  };
}

export function sanitizeDocument(document) {
  const source = document && typeof document === 'object' ? document : {};
  let nextId = Number.isFinite(Number(source.nextId))
    ? Math.max(1, Math.floor(Number(source.nextId)))
    : 1;
  const usedIds = new Set();
  const curves = Array.isArray(source.curves) ? source.curves : [];

  const validCurves = curves.flatMap((curve) => {
    if (!curve || typeof curve !== 'object' || !Array.isArray(curve.points)) {
      return [];
    }
    const points = curve.points
      .filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))
      .map((point) => clampPoint({ x: point.x, y: point.y }, WORLD))
      .slice(0, MAX_DEGREE + 1);

    if (points.length < 2) return [];

    let id = typeof curve.id === 'string' && curve.id ? curve.id : `curve-${nextId++}`;
    if (usedIds.has(id)) id = `${id}-${nextId++}`;
    usedIds.add(id);
    const index = Number.parseInt(id.replace(/\D/g, ''), 10);
    if (Number.isFinite(index)) nextId = Math.max(nextId, index + 1);

    const splitOf = sanitizeSplitMeta(curve.splitOf);
    return [
      {
        id,
        points,
        splitOf,
        color: typeof curve.color === 'string' ? curve.color : PALETTE[usedIds.size % PALETTE.length],
      },
    ];
  });

  if (validCurves.length > 0) {
    const usedIds = new Set(validCurves.map((curve) => curve.id));
    validCurves.forEach((curve) => {
      if (curve.splitOf && (!usedIds.has(curve.splitOf.parentId) || !usedIds.has(curve.splitOf.siblingId))) {
        curve.splitOf = null;
      }
    });
    return { nextId, curves: validCurves };
  }

  return createInitialDocument();
}

function sanitizeSplitMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  if (
    typeof meta.parentId !== 'string' ||
    typeof meta.siblingId !== 'string' ||
    !Number.isFinite(Number(meta.t))
  ) {
    return null;
  }
  return {
    parentId: meta.parentId,
    siblingId: meta.siblingId,
    t: Math.min(1, Math.max(0, Number(meta.t))),
  };
}

export function validateSelection(document, selected) {
  const ids = new Set(document.curves.map((curve) => curve.id));
  return selected.filter((id) => ids.has(id));
}

export function movePoint(document, curveId, pointIndex, point) {
  return updateCurve(document, curveId, (curve) => ({
    ...curve,
    points: curve.points.map((existing, index) =>
      index === pointIndex ? clampPoint(point, WORLD) : existing,
    ),
  }));
}

export function addPoint(document, curveId, point) {
  const existing = document.curves.find((curve) => curve.id === curveId);
  if (existing && existing.points.length >= MAX_DEGREE + 1) {
    throw new Error(`最多支持 ${MAX_DEGREE} 阶，无法继续添加控制点`);
  }

  const safePoint = clampPoint(point, WORLD);
  if (existing) {
    return {
      document: updateCurve(document, curveId, (curve) => ({
        ...curve,
        points: [...curve.points, safePoint],
        splitOf: null,
      })),
      curveId,
    };
  }

  const id = `curve-${document.nextId}`;
  const second = {
    x: Math.min(WORLD.maxX, Math.max(WORLD.minX, safePoint.x + 120)),
    y: safePoint.y,
  };
  const curve = {
    id,
    points: [safePoint, second],
    splitOf: null,
    color: PALETTE[document.curves.length % PALETTE.length],
  };
  return {
    document: {
      ...document,
      nextId: document.nextId + 1,
      curves: [...document.curves, curve],
    },
    curveId: id,
  };
}

export function deletePoint(document, curveId, pointIndex) {
  const curve = document.curves.find((item) => item.id === curveId);
  if (!curve) return { document, removedCurve: false };

  if (curve.points.length <= 2) {
    return {
      document: {
        ...document,
        curves: document.curves.filter((item) => item.id !== curveId),
      },
      removedCurve: true,
    };
  }

  return {
    document: updateCurve(document, curveId, (item) => ({
      ...item,
      points: item.points.filter((_, index) => index !== pointIndex),
      splitOf: null,
    })),
    removedCurve: false,
  };
}

export function raiseSelected(document, curveId) {
  const curve = requireCurve(document, curveId);
  if (curve.points.length - 1 >= MAX_DEGREE) {
    throw new Error(`最多支持 ${MAX_DEGREE} 阶`);
  }
  return updateCurve(document, curveId, (item) => ({
    ...item,
    points: raiseDegree(item.points),
    splitOf: null,
  }));
}

export function lowerSelected(document, curveId) {
  const curve = requireCurve(document, curveId);
  const result = lowerDegree(curve.points);
  return {
    document: updateCurve(document, curveId, (item) => ({
      ...item,
      points: result.points,
      splitOf: null,
    })),
    error: result.error,
    exact: result.exact,
  };
}

export function splitSelected(document, curveId, t) {
  const curve = requireCurve(document, curveId);
  if (t <= 0 || t >= 1) throw new Error('分割参数必须位于 0 到 1 之间');
  if (t < 0.01 || t > 0.99) {
    throw new Error('为避免数值退化，分割参数应位于 0.01 到 0.99 之间');
  }
  const result = split(curve.points, t);
  let baseId = document.nextId;
  const existingIds = new Set(document.curves.map((item) => item.id));
  while (existingIds.has(`curve-${baseId}`) || existingIds.has(`curve-${baseId + 1}`)) {
    baseId += 1;
  }
  const leftId = `curve-${baseId}`;
  const rightId = `curve-${baseId + 1}`;
  const color = curve.color;
  const left = {
    id: leftId,
    points: result.left,
    color,
    splitOf: { parentId: curveId, siblingId: rightId, t },
  };
  const right = {
    id: rightId,
    points: result.right,
    color,
    splitOf: { parentId: curveId, siblingId: leftId, t },
  };
  const index = document.curves.findIndex((item) => item.id === curveId);
  const curves = document.curves.slice();
  curves.splice(index, 1, left, right);
  return {
    document: { ...document, nextId: baseId + 2, curves },
    ids: [leftId, rightId],
  };
}

export function mergeSelected(document, ids) {
  if (!ids || ids.length !== 2) {
    throw new Error('请选择恰好两条曲线用于合并');
  }
  let first = requireCurve(document, ids[0]);
  let second = requireCurve(document, ids[1]);

  let t = 0.5;
  const firstMeta = compatibleSplitMeta(first, second);
  const secondMeta = compatibleSplitMeta(second, first);
  if (firstMeta) t = firstMeta.t;
  else if (secondMeta) {
    t = secondMeta.t;
    [first, second] = [second, first];
  } else {
    if (!pointsEqual(first.points.at(-1), second.points[0])) {
      if (pointsEqual(second.points.at(-1), first.points[0])) {
        [first, second] = [second, first];
      } else {
        throw new Error('两条曲线的端点没有连接，无法合并');
      }
    }
    const firstLength = polylineLength(first.points);
    const totalLength = firstLength + polylineLength(second.points);
    t = totalLength > 1e-9
      ? Math.min(0.99, Math.max(0.01, firstLength / totalLength))
      : 0.5;
  }

  if (Math.max(first.points.length, second.points.length) > MAX_DEGREE + 1) {
    throw new Error(`合并结果会超过 ${MAX_DEGREE} 阶`);
  }

  const result = joinPair(first.points, second.points, t);
  if (result.degree > MAX_DEGREE) throw new Error(`最多支持 ${MAX_DEGREE} 阶`);

  const merged = {
    id: first.splitOf?.parentId || `curve-${document.nextId}`,
    points: result.points,
    color: first.color,
    splitOf: null,
  };
  const usedIds = new Set(document.curves.map((curve) => curve.id));
  if (usedIds.has(merged.id) && merged.id !== first.id && merged.id !== second.id) {
    merged.id = `curve-${document.nextId}`;
  }
  let nextId = document.nextId;
  if (merged.id === `curve-${nextId}`) nextId += 1;
  const curves = document.curves.filter(
    (curve) => curve.id !== first.id && curve.id !== second.id,
  );
  curves.push(merged);

  return {
    document: { ...document, nextId, curves },
    id: merged.id,
    error: result.error,
    exact: result.exact,
  };
}

function polylineLength(points, segments = 64) {
  let length = 0;
  let previous = evaluate(points, 0);
  for (let i = 1; i <= segments; i += 1) {
    const current = evaluate(points, i / segments);
    length += Math.hypot(current.x - previous.x, current.y - previous.y);
    previous = current;
  }
  return length;
}

function compatibleSplitMeta(first, second) {
  if (
    first.splitOf &&
    first.splitOf.siblingId === second.id &&
    second.splitOf &&
    second.splitOf.siblingId === first.id &&
    first.splitOf.parentId === second.splitOf.parentId &&
    Math.abs(first.splitOf.t - second.splitOf.t) <= 1e-9
  ) {
    return first.splitOf;
  }
  return null;
}

export function pointBoundsState(point) {
  return {
    inside: isInside(point, WORLD),
    clamped: clampPoint(point, WORLD),
  };
}

function updateCurve(document, curveId, updater) {
  return {
    ...document,
    curves: document.curves.map((curve) =>
      curve.id === curveId ? updater(curve) : curve,
    ),
  };
}

function requireCurve(document, curveId) {
  const curve = document.curves.find((item) => item.id === curveId);
  if (!curve) throw new Error('请选择一条曲线');
  return curve;
}

function pointsEqual(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) <= 1e-7;
}

export function createHistory(initial) {
  return {
    undo: [],
    redo: [],
    current: initial,
  };
}

export function commitHistory(history, next) {
  return {
    undo: [...history.undo.slice(-99), history.current],
    redo: [],
    current: next,
  };
}

export function undoHistory(history) {
  if (!history.undo.length) return history;
  const previous = history.undo.at(-1);
  return {
    undo: history.undo.slice(0, -1),
    redo: [history.current, ...history.redo].slice(0, 100),
    current: previous,
  };
}

export function redoHistory(history) {
  if (!history.redo.length) return history;
  const next = history.redo[0];
  return {
    undo: [...history.undo, history.current].slice(-100),
    redo: history.redo.slice(1),
    current: next,
  };
}
