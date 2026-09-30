(function (root) {
  'use strict';

  function maxPointDiff(a, b) {
    let m = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      m = Math.max(m, Math.hypot((a[i] && a[i].x || 0) - (b[i] && b[i].x || 0), (a[i] && a[i].y || 0) - (b[i] && b[i].y || 0)));
    }
    return m;
  }

  function run() {
    const B = root.BezierMath;
    const results = [];
    function test(name, fn) {
      try {
        const r = fn();
        results.push({ name, pass: r.pass, detail: r.detail });
      } catch (e) {
        results.push({ name, pass: false, detail: String(e && e.message || e) });
      }
    }
    const c3 = [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 0 }];

    test('求值：de Casteljau 与 Bernstein 基一致 (1e-10)', () => {
      let m = 0;
      for (let i = 0; i <= 200; i++) {
        const t = i / 200;
        const p1 = B.pointAt(c3, t);
        const w = B.bernsteinWeights(3, t);
        const p2 = { x: 0, y: 0 };
        c3.forEach((p, k) => { p2.x += w[k] * p.x; p2.y += w[k] * p.y; });
        m = Math.max(m, Math.hypot(p1.x - p2.x, p1.y - p2.y));
      }
      return { pass: m < 1e-10, detail: 'max diff ' + m.toExponential(2) };
    });

    test('端点求值 P(0)=P0, P(1)=Pn', () => {
      const a = B.pointAt(c3, 0), b = B.pointAt(c3, 1);
      return { pass: maxPointDiff([a], [c3[0]]) < 1e-12 && maxPointDiff([b], [c3[3]]) < 1e-12 };
    });

    test('升阶：曲线形状不变 (128 采样, 1e-9)', () => {
      const e = B.elevate(c3);
      let m = 0;
      for (let i = 0; i <= 128; i++) {
        const t = i / 128;
        const p1 = B.pointAt(c3, t), p2 = B.pointAt(e, t);
        m = Math.max(m, Math.hypot(p1.x - p2.x, p1.y - p2.y));
      }
      return { pass: m < 1e-9 && e.length === 5, detail: 'max diff ' + m.toExponential(2) };
    });

    test('降阶：升阶后降阶还原原控制多边形', () => {
      const e = B.elevate(c3);
      const r = B.reduceLS(e);
      return { pass: !!r && maxPointDiff(r.points, c3) < 1e-6, detail: r ? ('residual ' + r.residual.toExponential(2)) : 'null' };
    });

    test('分割：t=0.3/0.5/0.8 左右段与原曲线一致', () => {
      let m = 0;
      for (const t of [0.3, 0.5, 0.8]) {
        const s = B.split(c3, t);
        for (let i = 0; i <= 100; i++) {
          const u = i / 100;
          const pL = B.pointAt(s.left, u), pR = B.pointAt(s.right, u);
          const eL = B.pointAt(c3, t * u), eR = B.pointAt(c3, t + (1 - t) * u);
          m = Math.max(m, Math.hypot(pL.x - eL.x, pL.y - eL.y));
          m = Math.max(m, Math.hypot(pR.x - eR.x, pR.y - eR.y));
        }
      }
      return { pass: m < 1e-9, detail: 'max diff ' + m.toExponential(2) };
    });

    test('合并：任意 t 分割后精确合并还原 (n=3)', () => {
      let m = 0; let tm = 0;
      for (let i = 1; i < 20; i++) {
        const t = i / 20;
        const s = B.split(c3, t);
        const r = B.tryMergeExact(s.left, s.right);
        if (!r) return { pass: false, detail: 'merge null at t=' + t };
        m = Math.max(m, maxPointDiff(r.points, c3));
        tm = Math.max(tm, Math.abs(r.t - t));
      }
      return { pass: m < 1e-6 && tm < 1e-6, detail: 'points ' + m.toExponential(2) + ', t ' + tm.toExponential(2) };
    });

    test('合并：n=2/4/6 阶合并往返', () => {
      let m = 0;
      for (const n of [2, 4, 6]) {
        const pts = [];
        for (let i = 0; i <= n; i++) pts.push({ x: 60 * i + Math.sin(i) * 30, y: 120 + Math.cos(i * 1.7) * 80 });
        const s = B.split(pts, 0.37);
        const r = B.tryMergeExact(s.left, s.right);
        if (!r) return { pass: false, detail: 'null n=' + n };
        m = Math.max(m, maxPointDiff(r.points, pts));
      }
      return { pass: m < 1e-6, detail: 'max diff ' + m.toExponential(2) };
    });

    test('切线：与数值微分一致 (1e-6)', () => {
      let m = 0;
      for (let i = 0; i <= 50; i++) {
        const t = i / 50;
        const tv = B.tangentVector(c3, t);
        const e = 1e-6;
        const pa = B.pointAt(c3, Math.min(1, t + e));
        const pb = B.pointAt(c3, Math.max(0, t - e));
        const nx = (pa.x - pb.x) / (2 * e), ny = (pa.y - pb.y) / (2 * e);
        const la = Math.hypot(tv.x, tv.y), lb = Math.hypot(nx, ny);
        const cos = la && lb ? (tv.x * nx + tv.y * ny) / (la * lb) : 1;
        m = Math.max(m, Math.acos(Math.max(-1, Math.min(1, cos))));
      }
      return { pass: m < 1e-5, detail: 'max angle err ' + m.toExponential(2) };
    });

    test('曲率：圆在 t=0.5 解析值正确', () => {
      const q = [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 0 }];
      const f = B.evalFull(q, 0.5);
      return { pass: Math.abs(f.signedCurvature + 2) < 1e-9, detail: 'κ=' + f.signedCurvature };
    });

    test('曲率：直线恒为 0', () => {
      const line = [{ x: 0, y: 5 }, { x: 100, y: 5 }];
      let m = 0;
      for (let i = 0; i <= 20; i++) m = Math.max(m, Math.abs(B.evalFull(line, i / 20).curvature));
      return { pass: m === 0, detail: 'max ' + m };
    });

    test('展开：自适应折线端点与容差', () => {
      const poly = B.flatten(c3, 0.25, 2048);
      const ends = Math.hypot(poly[0].x - c3[0].x, poly[0].y - c3[0].y) +
        Math.hypot(poly[poly.length - 1].x - c3[3].x, poly[poly.length - 1].y - c3[3].y);
      return { pass: ends < 1e-9 && poly.length >= 3, detail: poly.length - 1 + ' segments' };
    });

    test('高阶不崩：n=48 求值/展开/降阶', () => {
      const pts = [];
      for (let i = 0; i <= 48; i++) pts.push({ x: i * 12, y: 150 + Math.sin(i * 0.7) * 60 });
      const p = B.pointAt(pts, 0.5);
      const poly = B.flatten(pts, 1, 4096);
      const r = B.reduceLS(pts);
      const ok = isFinite(p.x) && isFinite(p.y) && poly.length > 2 && !!r;
      return { pass: ok, detail: poly.length + ' pts, residual ' + (r ? r.residual.toExponential(2) : 'n/a') };
    });

    return results;
  }

  root.BezierSelfTest = { run };
})(typeof self !== 'undefined' ? self : this);
