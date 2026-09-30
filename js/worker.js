'use strict';
importScripts('bezier.js');
const BM = self.BezierMath;

function computeCurve(curve, options) {
  const tolerance = options.tolerance == null ? 0.45 : options.tolerance;
  const combCount = options.combCount || 96;
  let poly;
  let degraded = false;
  const degree = curve.points.length - 1;

  if (degree <= 32 && curve.points.length <= 64) {
    poly = BM.flatten(curve.points, tolerance, 4096);
    if (poly.length > 2048) {
      degraded = true;
      poly = BM.sampleUniform(curve.points, 256).map(s => ({ x: s.p.x, y: s.p.y, t: s.t }));
    }
  } else {
    degraded = true;
    const N = Math.min(1024, Math.max(64, degree * 4));
    poly = BM.sampleUniform(curve.points, N).map(s => ({ x: s.p.x, y: s.p.y, t: s.t }));
  }

  const comb = [];
  let maxK = 1e-9;
  for (let i = 0; i <= combCount; i++) {
    const t = i / combCount;
    const f = BM.evalFull(curve.points, t);
    comb.push({ t, k: f.signedCurvature, px: f.point.x, py: f.point.y, speed: f.speed });
    if (Math.abs(f.signedCurvature) > maxK) maxK = Math.abs(f.signedCurvature);
  }

  return {
    id: curve.id,
    version: curve.version,
    poly: poly.map(p => [p.x, p.y, p.t]),
    comb: comb.map(c => [c.t, c.k, c.px, c.py]),
    maxCurvature: maxK,
    degraded
  };
}

self.onmessage = function (ev) {
  const msg = ev.data;
  if (msg.type === 'tessellate') {
    try {
      const results = (msg.curves || []).map(c => {
        try {
          return computeCurve(c, msg.options || {});
        } catch (err) {
          return { id: c.id, version: c.version, error: String(err && err.message || err) };
        }
      });
      self.postMessage({ type: 'tessellated', requestId: msg.requestId, results });
    } catch (err) {
      self.postMessage({ type: 'tessellated', requestId: msg.requestId, results: [], error: String(err && err.message || err) });
    }
  }
};
