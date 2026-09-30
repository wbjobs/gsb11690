(function (root) {
  'use strict';

  function binom(n, k) {
    if (k < 0 || k > n) return 0;
    if (k === 0 || k === n) return 1;
    k = Math.min(k, n - k);
    let c = 1;
    for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
    return Math.round(c);
  }

  function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }

  function pointAt(points, t) {
    const tmp = points.map(p => ({ x: p.x, y: p.y }));
    const n = tmp.length - 1;
    for (let k = 1; k <= n; k++) {
      for (let i = 0; i <= n - k; i++) tmp[i] = lerp(tmp[i], tmp[i + 1], t);
    }
    return tmp[0];
  }

  function deCasteljauTri(points, t) {
    const n = points.length - 1;
    const tri = [points.map(p => ({ x: p.x, y: p.y }))];
    for (let k = 1; k <= n; k++) {
      const prev = tri[k - 1];
      const row = [];
      for (let i = 0; i <= n - k; i++) row.push(lerp(prev[i], prev[i + 1], t));
      tri.push(row);
    }
    return tri;
  }

  function derivativePoints(points, order) {
    let pts = points.map(p => ({ x: p.x, y: p.y }));
    for (let o = 0; o < (order || 1); o++) {
      const n = pts.length - 1;
      if (n <= 0) return [{ x: 0, y: 0 }];
      const next = [];
      for (let i = 0; i < n; i++) {
        next.push({ x: n * (pts[i + 1].x - pts[i].x), y: n * (pts[i + 1].y - pts[i].y) });
      }
      pts = next;
    }
    return pts;
  }

  function tangentVector(points, t) {
    const d = derivativePoints(points, 1);
    if (t <= 0) return { x: d[0].x, y: d[0].y };
    if (t >= 1) return { x: d[d.length - 1].x, y: d[d.length - 1].y };
    return pointAt(d, t);
  }

  function angle(points, t) {
    const v = tangentVector(points, t);
    return Math.atan2(v.y, v.x);
  }

  function evalFull(points, t) {
    const p = pointAt(points, t);
    const d1p = derivativePoints(points, 1);
    const d2p = derivativePoints(points, 2);
    const d1 = pointAt(d1p, t);
    const d2 = d2p.length > 1 ? pointAt(d2p, t) : d2p[0];
    const speed = Math.hypot(d1.x, d1.y);
    const cross = d1.x * d2.y - d1.y * d2.x;
    const signed = speed > 1e-12 ? cross / (speed * speed * speed) : 0;
    return {
      point: p,
      tangent: d1,
      angle: Math.atan2(d1.y, d1.x),
      speed,
      secondDerivative: d2,
      curvature: Math.abs(signed),
      signedCurvature: signed,
      radius: Math.abs(signed) > 1e-12 ? 1 / Math.abs(signed) : Infinity
    };
  }

  function split(points, t) {
    const tri = deCasteljauTri(points, t);
    const n = points.length - 1;
    const left = [];
    const right = new Array(n + 1);
    for (let k = 0; k <= n; k++) {
      left.push({ x: tri[k][0].x, y: tri[k][0].y });
      right[k] = { x: tri[n - k][k].x, y: tri[n - k][k].y };
    }
    return { left, right };
  }

  function elevate(points) {
    const n = points.length - 1;
    const out = [{ x: points[0].x, y: points[0].y }];
    for (let i = 1; i <= n; i++) {
      const ai = i / (n + 1);
      out.push({
        x: ai * points[i - 1].x + (1 - ai) * points[i].x,
        y: ai * points[i - 1].y + (1 - ai) * points[i].y
      });
    }
    out.push({ x: points[n].x, y: points[n].y });
    return out;
  }

  root.BezierMath = {
    binom, lerp, pointAt, deCasteljauTri, derivativePoints,
    tangentVector, angle, evalFull, split, elevate
  };
})(typeof self !== 'undefined' ? self : this);

(function (root) {
  'use strict';
  const BM = root.BezierMath;
  const binom = BM.binom;

  function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }
  function maxDim(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    return Math.max(maxX - minX, maxY - minY, 1);
  }

  function gaussianSolve(A, bVec) {
    const n = A.length;
    function solve(rhs) {
      const mat = A.map((row, i) => row.concat([rhs[i]]));
      for (let col = 0; col < n; col++) {
        let piv = col;
        for (let r = col + 1; r < n; r++) {
          if (Math.abs(mat[r][col]) > Math.abs(mat[piv][col])) piv = r;
        }
        if (Math.abs(mat[piv][col]) < 1e-14) return null;
        if (piv !== col) { const tmp = mat[piv]; mat[piv] = mat[col]; mat[col] = tmp; }
        for (let r = col + 1; r < n; r++) {
          const f = mat[r][col] / mat[col][col];
          if (f === 0) continue;
          for (let c = col; c <= n; c++) mat[r][c] -= f * mat[col][c];
        }
      }
      const x = new Array(n);
      for (let i = n - 1; i >= 0; i--) {
        let s = mat[i][n];
        for (let j = i + 1; j < n; j++) s -= mat[i][j] * x[j];
        x[i] = s / mat[i][i];
      }
      return x;
    }
    const sx = solve(bVec.map(p => p.x));
    if (!sx) return null;
    const sy = solve(bVec.map(p => p.y));
    if (!sy) return null;
    return sx.map((v, i) => ({ x: v, y: sy[i] }));
  }

  function bernsteinWeights(n, t) {
    const w = new Array(n + 1);
    if (t === 0) { w[0] = 1; for (let k = 1; k <= n; k++) w[k] = 0; return w; }
    if (t === 1) { w[n] = 1; for (let k = 0; k < n; k++) w[k] = 0; return w; }
    const u = 1 - t;
    for (let k = 0; k <= n; k++) w[k] = binom(n, k) * Math.pow(u, n - k) * Math.pow(t, k);
    return w;
  }

  function gaussianSolveNormal(A, bx, by) {
    const rows = A.length, cols = A[0].length;
    const NtN = Array.from({ length: cols }, () => new Array(cols).fill(0));
    const nbx = new Array(cols).fill(0), nby = new Array(cols).fill(0);
    for (let i = 0; i < rows; i++) {
      for (let a = 0; a < cols; a++) {
        nbx[a] += A[i][a] * bx[i];
        nby[a] += A[i][a] * by[i];
        for (let b2 = 0; b2 < cols; b2++) NtN[a][b2] += A[i][a] * A[i][b2];
      }
    }
    return gaussianSolve(NtN, nbx.map((v, i) => ({ x: v, y: nby[i] })));
  }

  function maxResidual(pts, samples) {
    let worst = 0;
    for (const s of samples) {
      const p = BM.pointAt(pts, s.t);
      const d = Math.sqrt(dist2(p, s.p));
      if (d > worst) worst = d;
    }
    return worst;
  }

  function fitBezier(samples, degree, pinned) {
    const n = degree;
    const W = samples.map(s => bernsteinWeights(n, s.t));
    if (pinned && n >= 1) {
      const m = n - 1;
      const p0 = samples[0].p;
      const pEnd = samples[samples.length - 1].p;
      if (m === 0) return { points: [{ x: p0.x, y: p0.y }, { x: pEnd.x, y: pEnd.y }], residual: maxResidual([p0, pEnd], samples) };
      const A = W.map(w => w.slice(1, n));
      const bx = samples.map((s, si) => s.p.x - W[si][0] * p0.x - W[si][n] * pEnd.x);
      const by = samples.map((s, si) => s.p.y - W[si][0] * p0.y - W[si][n] * pEnd.y);
      const sol = gaussianSolveNormal(A, bx, by);
      if (!sol) return null;
      const pts = [{ x: p0.x, y: p0.y }].concat(sol).concat([{ x: pEnd.x, y: pEnd.y }]);
      return { points: pts, residual: maxResidual(pts, samples) };
    }
    const sol = gaussianSolveNormal(W.map(w => w.slice()), samples.map(s => s.p.x), samples.map(s => s.p.y));
    if (!sol) return null;
    return { points: sol, residual: maxResidual(sol, samples) };
  }

  function sampleUniform(points, count) {
    const out = [];
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      out.push({ t, p: BM.pointAt(points, t) });
    }
    return out;
  }

  function reduceLS(points) {
    const n = points.length - 1;
    if (n <= 1) return null;
    const samples = sampleUniform(points, Math.max(128, n * 16));
    const fit = fitBezier(samples, n - 1, true);
    if (!fit) return null;
    fit.scale = maxDim(points);
    return fit;
  }

  root.BezierMath.fitBezier = fitBezier;
  root.BezierMath.reduceLS = reduceLS;
  root.BezierMath.sampleUniform = sampleUniform;
  root.BezierMath.bernsteinWeights = bernsteinWeights;
  root.BezierMath.gaussianSolve = gaussianSolve;
  root.BezierMath.polylineLength = function (pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.sqrt(dist2(pts[i - 1], pts[i]));
    return L;
  };
  root.BezierMath.maxDim = maxDim;
  root.BezierMath.dist2 = dist2;
})(typeof self !== 'undefined' ? self : this);

(function (root) {
  'use strict';
  const BM = root.BezierMath;
  const dist2 = BM.dist2;

  function mergeExact(left, right) {
    const n1 = left.length - 1;
    const n2 = right.length - 1;
    if (n1 !== n2) return null;
    const n = n1;
    const tol = 1e-7 * Math.max(1, BM.maxDim(left.concat(right)));
    if (dist2(left[n], right[0]) > tol * tol) return null;


    const scale = BM.maxDim(left.concat(right));
    const eps2 = (1e-10 * scale) * (1e-10 * scale);
    const b = left[n];
    const lvx = b.x - left[n - 1].x;
    const lvy = b.y - left[n - 1].y;
    const rvx = right[1].x - b.x;
    const rvy = right[1].y - b.y;
    const dl2 = lvx * lvx + lvy * lvy;
    const dr2 = rvx * rvx + rvy * rvy;
    if (dl2 < eps2 || dr2 < eps2) return null;
    const dot = lvx * rvx + lvy * rvy;
    if (dot < -Math.sqrt(dl2 * dr2) * (1 - 1e-7)) return null;
    let t = Math.sqrt(dl2) / (Math.sqrt(dl2) + Math.sqrt(dr2));
    if (!(t > 1e-9 && t < 1 - 1e-9)) return null;

    const rows = new Array(n + 1);
    rows[n] = [b];
    for (let k = n - 1; k >= 1; k--) {
      const len = n - k + 1;
      const rk = new Array(len);
      rk[0] = left[k];
      rk[len - 1] = right[n - k];
      const below = rows[k + 1];
      for (let i = 1; i <= len - 2; i++) {
        rk[i] = {
          x: (below[i - 1].x - (1 - t) * rk[i - 1].x) / t,
          y: (below[i - 1].y - (1 - t) * rk[i - 1].y) / t
        };
      }
      rows[k] = rk;
    }
    const original = new Array(n + 1);
    original[0] = left[0];
    for (let i = 1; i <= n; i++) {
      original[i] = {
        x: (rows[1][i - 1].x - (1 - t) * original[i - 1].x) / t,
        y: (rows[1][i - 1].y - (1 - t) * original[i - 1].y) / t
      };
    }

    const splitCheck = BM.split(original, t);
    for (let i = 0; i <= n; i++) {
      if (dist2(splitCheck.left[i], left[i]) > tol * tol) return null;
      if (dist2(splitCheck.right[i], right[i]) > tol * tol) return null;
    }
    return { points: original, t };
  }

  function tryMergeExact(c1, c2) {
    let r = mergeExact(c1, c2);
    if (r) return r;
    const rev1 = c1.slice().reverse();
    const rev2 = c2.slice().reverse();
    r = mergeExact(c2, c1);
    if (r) return { points: r.points, t: 1 - r.t };
    r = mergeExact(rev2, rev1);
    if (r) {
      return { points: r.points.slice().reverse(), t: 1 - r.t };
    }
    r = mergeExact(rev1, rev2);
    if (r) {
      return { points: r.points.slice().reverse(), t: r.t };
    }
    return null;
  }

  function approximateMerge(c1, c2, samplesPerSpan) {
    const n1 = c1.length - 1, n2 = c2.length - 1;
    const tol = 1e-6 * Math.max(1, BM.maxDim(c1.concat(c2)));
    let c1a = c1, c2a = c2;
    for (let i = n1; i < n2; i++) c1a = BM.elevate(c1a);
    for (let i = n2; i < n1; i++) c2a = BM.elevate(c2a);
    if (dist2(c1a[c1a.length - 1], c2a[0]) > (tol * 4) * (tol * 4)) return null;

    const count = samplesPerSpan || 96;
    const s1 = BM.sampleUniform(c1a, count);
    const s2 = BM.sampleUniform(c2a, count);
    const L1 = BM.polylineLength(s1.map(s => s.p));
    const L2 = BM.polylineLength(s2.map(s => s.p));
    const total = L1 + L2;
    const alpha = total > 1e-12 ? L1 / total : 0.5;
    const samples = [];
    for (let i = 0; i < s1.length; i++) {
      samples.push({ t: alpha * s1[i].t, p: s1[i].p });
    }
    for (let i = 1; i < s2.length; i++) {
      samples.push({ t: alpha + (1 - alpha) * s2[i].t, p: s2[i].p });
    }
    const degree = Math.max(c1a.length - 1, c2a.length - 1);
    const fit = BM.fitBezier(samples, degree, true);
    if (!fit) return null;
    fit.t = alpha;
    return fit;
  }

  function flatten(points, tolerance, maxSegments) {
    const n = points.length - 1;
    const tol = tolerance == null ? 0.5 : tolerance;
    const budget = maxSegments || 2048;
    const tol2 = tol * tol;
    const out = [{ x: points[0].x, y: points[0].y, t: 0 }];
    const stack = [{ t0: 0, t1: 1, pts: points }];
    let guard = 0;
    const maxIter = budget * 6 + 64;

    function flatEnough(pts) {
      const deg = pts.length - 1;
      if (deg <= 1) return true;
      let dx = pts[deg].x - pts[0].x, dy = pts[deg].y - pts[0].y;
      const d2 = dx * dx + dy * dy;
      let worst = 0;
      if (d2 < 1e-20) {
        for (let i = 1; i < deg; i++) worst = Math.max(worst, dist2(pts[i], pts[0]));
      } else {
        for (let i = 1; i < deg; i++) {
          let cross = dx * (pts[0].y - pts[i].y) - dy * (pts[0].x - pts[i].x);
          let d = (cross * cross) / d2;
          if (d > worst) worst = d;
        }
      }
      return worst <= tol2;
    }

    while (stack.length) {
      if (++guard > maxIter || out.length - 1 >= budget) {
        const item = stack.pop();
        out.push({ x: item.pts[item.pts.length - 1].x, y: item.pts[item.pts.length - 1].y, t: item.t1 });
        continue;
      }
      const item = stack.pop();
      if (flatEnough(item.pts)) {
        out.push({ x: item.pts[item.pts.length - 1].x, y: item.pts[item.pts.length - 1].y, t: item.t1 });
        continue;
      }
      const tm = (item.t0 + item.t1) / 2;
      const sp = BM.split(item.pts, 0.5);
      stack.push({ t0: tm, t1: item.t1, pts: sp.right });
      stack.push({ t0: item.t0, t1: tm, pts: sp.left });
    }
    return out;
  }

  function bbox(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
  }

  BM.mergeExact = mergeExact;
  BM.tryMergeExact = tryMergeExact;
  BM.approximateMerge = approximateMerge;
  BM.flatten = flatten;
  BM.bbox = bbox;
})(typeof self !== 'undefined' ? self : this);
