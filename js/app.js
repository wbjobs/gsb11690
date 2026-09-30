(function () {
  'use strict';

  const BM = window.BezierMath;
  const Geo = window.Geometry;
  const IDB = window.IDB;

  const MAX_DEGREE = 48;
  const HANDLE_HIT_RADIUS = 9;
  const CURVE_HIT_RADIUS = 7;
  const UNDO_LIMIT = 60;
  const STATE_KEY = 'bezier-editor-state-v1';
  const SETTINGS_KEY = 'bezier-editor-settings-v1';
  const PERSIST_DELAY = 350;

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');

  const dom = {
    addPoint: document.getElementById('btn-add-point'),
    deletePoint: document.getElementById('btn-delete-point'),
    elevate: document.getElementById('btn-elevate'),
    reduce: document.getElementById('btn-reduce'),
    split: document.getElementById('btn-split'),
    merge: document.getElementById('btn-merge'),
    clear: document.getElementById('btn-clear'),
    reset: document.getElementById('btn-reset'),
    undo: document.getElementById('btn-undo'),
    redo: document.getElementById('btn-redo'),
    selfTest: document.getElementById('btn-selftest'),
    tRange: document.getElementById('t-range'),
    tValue: document.getElementById('t-value'),
    clampPoints: document.getElementById('opt-clamp'),
    showPolygon: document.getElementById('opt-polygon'),
    showComb: document.getElementById('opt-comb'),
    showOsculating: document.getElementById('opt-osculating'),
    status: document.getElementById('status'),
    toast: document.getElementById('toast'),
    info: {
      degree: document.getElementById('info-degree'),
      points: document.getElementById('info-points'),
      segCount: document.getElementById('info-segments'),
      evalX: document.getElementById('eval-x'),
      evalY: document.getElementById('eval-y'),
      tangent: document.getElementById('eval-tangent'),
      speed: document.getElementById('eval-speed'),
      curvature: document.getElementById('eval-curvature'),
      radius: document.getElementById('eval-radius')
    },
    testResults: document.getElementById('test-results')
  };

  const defaultCurve = {
    id: 'c1',
    version: 1,
    color: '#4ea1ff',
    points: [
      { x: 140, y: 320 },
      { x: 260, y: 120 },
      { x: 420, y: 160 },
      { x: 560, y: 300 }
    ]
  };

  function initialState() {
    return {
      nextId: 2,
      curves: [clone(defaultCurve)],
      selectedCurveId: 'c1',
      selectedPointIndex: null
    };
  }

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function uid() {
    const n = state.nextId++;
    return 'c' + n;
  }

  let state = initialState();
  let settings = {
    clamp: false,
    polygon: true,
    comb: false,
    osculating: false,
    t: 0.5
  };

  let undoStack = [];
  let redoStack = [];
  let tessCache = new Map();
  let viewport = { w: 0, h: 0, dpr: 1 };
  let drag = null;
  let rafQueued = false;
  let persistTimer = null;
  let worker = null;
  let workerSeq = 0;
  let lastWorkerRequest = 0;
  let workerSupported = true;
  let draggingCurveTess = null;

  function toastMessage(msg, kind) {
    dom.toast.textContent = msg;
    dom.toast.className = 'toast show ' + (kind || '');
    clearTimeout(toastMessage._t);
    toastMessage._t = setTimeout(() => { dom.toast.className = 'toast'; }, 2200);
  }

  function snapshot() {
    undoStack.push(clone({ state }));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
    updateButtons();
    schedulePersist();
  }

  function restoreStateInto(next) {
    Object.keys(state).forEach(k => delete state[k]);
    Object.assign(state, next);
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(clone({ state }));
    restoreStateInto(undoStack.pop().state);
    invalidateAll();
    render();
    updateButtons();
    schedulePersist();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(clone({ state }));
    restoreStateInto(redoStack.pop().state);
    invalidateAll();
    render();
    updateButtons();
    schedulePersist();
  }

  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, PERSIST_DELAY);
  }

  function persist() {
    IDB.set(STATE_KEY, {
      state,
      undo: undoStack.slice(-UNDO_LIMIT),
      redo: redoStack.slice(-UNDO_LIMIT)
    }).catch(() => {});
    IDB.set(SETTINGS_KEY, settings).catch(() => {});
  }

  function restore() {
    return IDB.get(STATE_KEY).then(saved => {
      if (saved && saved.state && Array.isArray(saved.state.curves)) {
        restoreStateInto(saved.state);
        undoStack = Array.isArray(saved.undo) ? saved.undo.slice(-UNDO_LIMIT) : [];
        redoStack = Array.isArray(saved.redo) ? saved.redo.slice(-UNDO_LIMIT) : [];
      }
      return IDB.get(SETTINGS_KEY).then(s => {
        if (s) settings = Object.assign(settings, s);
      });
    }).catch(() => {});
  }

  function selectedCurve() {
    return state.curves.find(c => c.id === state.selectedCurveId) || null;
  }

  function invalidateCurve(id) {
    tessCache.delete(id);
    requestTessellation();
  }
  function invalidateAll() {
    tessCache.clear();
    requestTessellation();
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    viewport = { w: rect.width, h: rect.height, dpr };
    render();
  }

  function clampPoint(p) {
    if (!settings.clamp) return p;
    return {
      x: Math.max(0, Math.min(viewport.w, p.x)),
      y: Math.max(0, Math.min(viewport.h, p.y))
    };
  }

  function beginCurveChange(id) {
    const c = state.curves.find(x => x.id === id);
    if (c) c.version = (c.version || 1) + 1;
    invalidateCurve(id);
  }

  window.APP = {
    state: () => state,
    settings: () => settings,
    BM
  };

  function initWorker() {
    try {
      worker = new Worker('js/worker.js');
      worker.onmessage = onWorkerMessage;
      worker.onerror = () => {
        workerSupported = false;
        worker = null;
        tessCache.clear();
        render();
      };
    } catch (e) {
      workerSupported = false;
      worker = null;
    }
  }

  function requestTessellation() {
    if (!workerSupported || !worker) {
      render();
      return;
    }
    const need = state.curves.filter(c => {
      const cached = tessCache.get(c.id);
      return !cached || cached.version !== c.version;
    });
    if (!need.length) {
      render();
      return;
    }
    const requestId = ++workerSeq;
    lastWorkerRequest = requestId;
    worker.postMessage({
      type: 'tessellate',
      requestId,
      curves: need.map(c => ({ id: c.id, version: c.version, points: c.points })),
      options: { tolerance: 0.45, combCount: 120 }
    });
  }

  function onWorkerMessage(ev) {
    const msg = ev.data;
    if (msg.type !== 'tessellated') return;
    // Stale replies are discarded per curve via the version check below.
    for (const r of (msg.results || [])) {
      const c = state.curves.find(x => x.id === r.id);
      if (!c || c.version !== r.version) continue;
      tessCache.set(r.id, {
        version: r.version,
        poly: (r.poly || []).map(p => ({ x: p[0], y: p[1], t: p[2] })),
        comb: (r.comb || []).map(q => ({ t: q[0], k: q[1], px: q[2], py: q[3] })),
        maxCurvature: r.maxCurvature,
        degraded: !!r.degraded
      });
    }
    render();
  }

  function fallbackTess(curve) {
    const degree = curve.points.length - 1;
    let poly;
    let degraded = false;
    try {
      if (degree <= 32) {
        poly = BM.flatten(curve.points, 0.45, 4096);
        if (poly.length > 2048) throw new Error('too many segments');
      } else {
        throw new Error('high degree');
      }
    } catch (e) {
      degraded = true;
      const N = Math.min(1024, Math.max(48, degree * 4));
      poly = BM.sampleUniform(curve.points, N).map(s => ({ x: s.p.x, y: s.p.y, t: s.t }));
    }
    const comb = [];
    let maxK = 1e-9;
    for (let i = 0; i <= 96; i++) {
      const t = i / 96;
      const f = BM.evalFull(curve.points, t);
      comb.push({ t, k: f.signedCurvature, px: f.point.x, py: f.point.y });
      if (Math.abs(f.signedCurvature) > maxK) maxK = Math.abs(f.signedCurvature);
    }
    return { version: curve.version, poly, comb, maxCurvature: maxK, degraded, fallback: true };
  }

  function getTess(curve) {
    if (drag && drag.curveId === curve.id && draggingCurveTess) return draggingCurveTess;
    const cached = tessCache.get(curve.id);
    if (cached && cached.version === curve.version) return cached;
    if (!workerSupported) {
      const t = fallbackTess(curve);
      tessCache.set(curve.id, t);
      return t;
    }
    return null;
  }

  function updateDragTess() {
    if (!drag) return;
    const c = state.curves.find(x => x.id === drag.curveId);
    if (!c) return;
    const degree = c.points.length - 1;
    let poly;
    if (degree <= 32) {
      poly = BM.flatten(c.points, 1.2, 700);
      if (poly.length > 700) poly = BM.sampleUniform(c.points, 96).map(s => ({ x: s.p.x, y: s.p.y, t: s.t }));
    } else {
      poly = BM.sampleUniform(c.points, 128).map(s => ({ x: s.p.x, y: s.p.y, t: s.t }));
    }
    const comb = [];
    let maxK = 1e-9;
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      const f = BM.evalFull(c.points, t);
      comb.push({ t, k: f.signedCurvature, px: f.point.x, py: f.point.y });
      if (Math.abs(f.signedCurvature) > maxK) maxK = Math.abs(f.signedCurvature);
    }
    draggingCurveTess = { version: c.version, poly, comb, maxCurvature: maxK, degraded: degree > 32, fallback: true };
  }

  function canvasPoint(ev) {
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function hitTestHandle(p) {
    let best = null;
    let bestD = HANDLE_HIT_RADIUS;
    for (const c of state.curves) {
      for (let i = 0; i < c.points.length; i++) {
        const pt = c.points[i];
        const d = Math.hypot(pt.x - p.x, pt.y - p.y);
        if (d <= bestD) {
          bestD = d;
          best = { curveId: c.id, pointIndex: i };
        }
      }
    }
    return best;
  }

  function hitTestCurve(p) {
    let best = null;
    let bestD = CURVE_HIT_RADIUS;
    for (const c of state.curves) {
      const tess = getTess(c);
      if (!tess) continue;
      const d = Geo.distanceToPolyline(p.x, p.y, tess.poly);
      if (d < bestD) {
        bestD = d;
        best = { curveId: c.id };
      }
    }
    return best;
  }

  function onPointerDown(ev) {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    canvas.setPointerCapture(ev.pointerId);
    const p = canvasPoint(ev);
    const handle = hitTestHandle(p);
    if (handle) {
      const additive = ev.shiftKey;
      if (!additive || state.selectedCurveId !== handle.curveId) {
        state.selectedCurveId = handle.curveId;
        state.selectedPointIndex = handle.pointIndex;
      }
      const c = selectedCurve();
      drag = {
        curveId: handle.curveId,
        pointIndex: handle.pointIndex,
        pointerId: ev.pointerId,
        moved: false,
        startState: clone(state),
        startX: p.x,
        startY: p.y,
        additive
      };
      updateDragTess();
      render();
      return;
    }
    const hit = hitTestCurve(p);
    if (hit) {
      if (ev.shiftKey) {
        const hc = state.curves.find(x => x.id === hit.curveId);
        hc._selected = !hc._selected;
      } else {
        state.curves.forEach(x => { x._selected = false; });
        state.selectedCurveId = hit.curveId;
        state.selectedPointIndex = null;
      }
      render();
      updateButtons();
      return;
    }
    if (!ev.shiftKey) {
      state.selectedCurveId = null;
      state.selectedPointIndex = null;
      state.curves.forEach(x => { x._selected = false; });
      render();
      updateButtons();
    }
  }

  function onPointerMove(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    const p = canvasPoint(ev);
    if (!drag.moved && Math.hypot(p.x - drag.startX, p.y - drag.startY) < 2) return;
    if (!drag.moved) {
      drag.moved = true;
      undoStack.push(clone({ state: drag.startState }));
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
      redoStack.length = 0;
    }
    const c = state.curves.find(x => x.id === drag.curveId);
    if (!c) return;
    let target = { x: p.x, y: p.y };
    if (settings.clamp) target = clampPoint(target);
    const pt = c.points[drag.pointIndex];
    const dx = target.x - pt.x, dy = target.y - pt.y;
    pt.x = target.x;
    pt.y = target.y;
    c.version = (c.version || 1) + 1;
    updateDragTess();
    scheduleRender();
    schedulePersist();
    void dx; void dy;
  }

  function onPointerUp(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    const wasDrag = drag.moved;
    drag = null;
    draggingCurveTess = null;
    if (wasDrag) {
      const c = selectedCurve();
      if (c) {
        tessCache.delete(c.id);
        requestTessellation();
      }
    }
    render();
    updateButtons();
  }

  function onDoubleClick(ev) {
    const p = canvasPoint(ev);
    const hit = hitTestHandle(p);
    if (hit) return;
    const target = clampPoint(p);
    const existing = hitTestCurve(p);
    const c = existing ? state.curves.find(x => x.id === existing.curveId) : selectedCurve();
    if (c) {
      if (c.points.length - 1 >= MAX_DEGREE) {
        toastMessage('已达到最高阶数 ' + MAX_DEGREE, 'warn');
        return;
      }
      snapshot();
      c.points.push({ x: target.x, y: target.y });
      c.version = (c.version || 1) + 1;
      state.selectedCurveId = c.id;
      state.selectedPointIndex = c.points.length - 1;
      beginCurveChange(c.id);
    } else {
      snapshot();
      const id = uid();
      const newCurve = {
        id,
        version: 1,
        color: pickColor(state.curves.length),
        points: [
          { x: target.x - 40, y: target.y },
          { x: target.x + 40, y: target.y }
        ]
      };
      state.curves.push(newCurve);
      state.selectedCurveId = id;
      state.selectedPointIndex = 1;
      invalidateAll();
    }
    render();
    updateButtons();
  }

  const PALETTE = ['#4ea1ff', '#ff8a5c', '#7bd88f', '#d77dff', '#ffd166', '#5ce1e6', '#ff6b9d', '#a3be8c'];
  function pickColor(i) { return PALETTE[i % PALETTE.length]; }

  function cmdAddPoint() {
    const c = selectedCurve();
    if (!c) {
      snapshot();
      const cx = viewport.w / 2, cy = viewport.h / 2;
      const id = uid();
      state.curves.push({
        id, version: 1, color: pickColor(state.curves.length),
        points: [{ x: cx - 40, y: cy }, { x: cx + 40, y: cy }]
      });
      state.selectedCurveId = id;
      state.selectedPointIndex = 1;
      invalidateAll();
      render();
      updateButtons();
      return;
    }
    if (c.points.length - 1 >= MAX_DEGREE) {
      toastMessage('已达到最高阶数 ' + MAX_DEGREE + '，无法继续添加控制点', 'warn');
      return;
    }
    snapshot();
    const last = c.points[c.points.length - 1];
    const prev = c.points[c.points.length - 2];
    const dx = prev ? last.x - prev.x : 30;
    const dy = prev ? last.y - prev.y : 0;
    c.points.push({ x: last.x + (prev ? dx * 0.4 : 30), y: last.y + (prev ? dy * 0.4 : 0) });
    c.version = (c.version || 1) + 1;
    state.selectedPointIndex = c.points.length - 1;
    beginCurveChange(c.id);
    render();
    updateButtons();
  }

  function cmdDeletePoint() {
    const c = selectedCurve();
    if (!c) return;
    if (state.selectedPointIndex == null) {
      if (state.curves.length > 0) {
        snapshot();
        state.curves = state.curves.filter(x => x.id !== c.id);
        state.selectedCurveId = state.curves.length ? state.curves[0].id : null;
        state.selectedPointIndex = null;
        invalidateAll();
        render();
        updateButtons();
      }
      return;
    }
    snapshot();
    if (c.points.length <= 2) {
      state.curves = state.curves.filter(x => x.id !== c.id);
      state.selectedCurveId = state.curves.length ? state.curves[state.curves.length - 1].id : null;
      state.selectedPointIndex = null;
      invalidateAll();
    } else {
      c.points.splice(state.selectedPointIndex, 1);
      c.version = (c.version || 1) + 1;
      state.selectedPointIndex = Math.min(state.selectedPointIndex, c.points.length - 1);
      beginCurveChange(c.id);
    }
    render();
    updateButtons();
  }

  function cmdElevate() {
    const c = selectedCurve();
    if (!c) return;
    if (c.points.length - 1 >= MAX_DEGREE) {
      toastMessage('阶数过高：已达到上限 ' + MAX_DEGREE, 'warn');
      return;
    }
    snapshot();
    c.points = BM.elevate(c.points);
    c.version = (c.version || 1) + 1;
    beginCurveChange(c.id);
    render();
    updateButtons();
  }

  function cmdReduce() {
    const c = selectedCurve();
    if (!c) return;
    if (c.points.length - 1 < 2) {
      toastMessage('阶数已是最低（1 阶直线）', 'warn');
      return;
    }
    const result = BM.reduceLS(c.points);
    if (!result) {
      toastMessage('降阶失败：方程组病态', 'warn');
      return;
    }
    snapshot();
    c.points = result.points;
    c.version = (c.version || 1) + 1;
    beginCurveChange(c.id);
    const rel = result.residual / Math.max(result.scale, 1);
    if (rel > 1e-3) {
      toastMessage('降阶完成，最大偏差 ' + result.residual.toFixed(2) + ' px（近似）', 'warn');
    }
    render();
    updateButtons();
  }

  function cmdSplit() {
    const c = selectedCurve();
    if (!c) return;
    const t = settings.t;
    if (t <= 0 || t >= 1) {
      toastMessage('分割参数必须在 (0,1) 内', 'warn');
      return;
    }
    snapshot();
    const parts = BM.split(c.points, t);
    const idx = state.curves.findIndex(x => x.id === c.id);
    const leftCurve = { id: c.id, version: 1, color: c.color, points: parts.left };
    const rightCurve = { id: uid(), version: 1, color: pickColor(state.curves.length), points: parts.right };
    state.curves.splice(idx, 1, leftCurve, rightCurve);
    state.selectedCurveId = rightCurve.id;
    state.selectedPointIndex = null;
    invalidateAll();
    render();
    updateButtons();
  }

  function selectedCurves() {
    return state.curves.filter(c => c._selected || c.id === state.selectedCurveId);
  }

  function cmdMerge() {
    if (state.curves.length < 2) {
      toastMessage('至少需要两条曲线', 'warn');
      return;
    }
    let ids = state.curves.filter(c => c._selected).map(c => c.id);
    if (ids.length !== 2) {
      toastMessage('请先点击「选择」模式并选中两条曲线（按住 Shift 点曲线体）', 'warn');
      return;
    }
    const c1 = state.curves.find(c => c.id === ids[0]);
    const c2 = state.curves.find(c => c.id === ids[1]);
    const threshold = 12 * Math.max(1, BM.maxDim(c1.points.concat(c2.points))) * 1e-7 + 0.5;
    const endpoints = [
      [c1.points[0], c1.points[c1.points.length - 1]],
      [c2.points[0], c2.points[c2.points.length - 1]]
    ];
    function near(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) <= threshold; }
    const connected =
      near(endpoints[0][1], endpoints[1][0]) || near(endpoints[0][0], endpoints[1][1]) ||
      near(endpoints[0][0], endpoints[1][0]) || near(endpoints[0][1], endpoints[1][1]);
    if (!connected) {
      toastMessage('两条曲线端点不重合，无法合并', 'warn');
      return;
    }

    let a = c1.points, b = c2.points;
    let m = BM.tryMergeExact(a, b);
    let mode = 'exact';
    if (!m) {
      const tryPairs = [
        [a, b], [b, a],
        [a.slice().reverse(), b], [a, b.slice().reverse()],
        [b.slice().reverse(), a.slice().reverse()]
      ];
      for (const pair of tryPairs) {
        const am = BM.approximateMerge(pair[0], pair[1], 128);
        if (am) {
          m = am;
          mode = 'approx';
          break;
        }
      }
    }
    if (!m) {
      toastMessage('合并失败', 'warn');
      return;
    }
    snapshot();
    const merged = { id: c1.id, version: 1, color: c1.color, points: m.points };
    const i2 = state.curves.findIndex(c => c.id === c2.id);
    const i1 = state.curves.findIndex(c => c.id === c1.id);
    state.curves.splice(Math.max(i1, i2), 1);
    state.curves.splice(Math.min(i1, i2), 1, merged);
    state.selectedCurveId = merged.id;
    state.selectedPointIndex = null;
    state.curves.forEach(c => { c._selected = false; });
    invalidateAll();
    render();
    updateButtons();
    toastMessage(mode === 'exact' ? '精确合并成功' : ('近似合并成功，最大偏差 ' + (m.residual || 0).toFixed(2) + ' px'), mode === 'exact' ? '' : 'warn');
  }

  function cmdClear() {
    if (!state.curves.length) return;
    snapshot();
    const cleared = initialState();
    cleared.curves = [];
    cleared.selectedCurveId = null;
    cleared.nextId = 1;
    restoreStateInto(cleared);
    invalidateAll();
    render();
    updateButtons();
  }

  function cmdReset() {
    snapshot();
    restoreStateInto(initialState());
    invalidateAll();
    render();
    updateButtons();
  }

  function scheduleRender() {
    if (rafQueued) return;
    rafQueued = true;
    requestAnimationFrame(() => {
      rafQueued = false;
      render();
    });
  }

  function arrow(ctx, x1, y1, x2, y2) {
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const s = 8;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - s * Math.cos(ang - Math.PI / 6), y2 - s * Math.sin(ang - Math.PI / 6));
    ctx.lineTo(x2 - s * Math.cos(ang + Math.PI / 6), y2 - s * Math.sin(ang + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  function drawGrid() {
    ctx.save();
    ctx.scale(viewport.dpr, viewport.dpr);
    ctx.fillStyle = '#0f1420';
    ctx.fillRect(0, 0, viewport.w, viewport.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = 40;
    for (let x = step; x < viewport.w; x += step) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, viewport.h); }
    for (let y = step; y < viewport.h; y += step) { ctx.moveTo(0, y + 0.5); ctx.lineTo(viewport.w, y + 0.5); }
    ctx.stroke();
    ctx.restore();
  }

  function drawCurve(curve, tess) {
    ctx.save();
    ctx.scale(viewport.dpr, viewport.dpr);
    if (!tess) {
      const samples = BM.sampleUniform(curve.points, 96);
      ctx.strokeStyle = curve.color;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      samples.forEach((s, i) => i ? ctx.lineTo(s.p.x, s.p.y) : ctx.moveTo(s.p.x, s.p.y));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }
    const selected = curve.id === state.selectedCurveId || curve._selected;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = curve.color;
    ctx.globalAlpha = selected ? 1 : 0.75;
    ctx.lineWidth = selected ? 2.6 : 2;
    if (tess.degraded) ctx.setLineDash([7, 4]);
    ctx.beginPath();
    tess.poly.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawPolygon(curve) {
    if (!settings.polygon) return;
    const selected = curve.id === state.selectedCurveId;
    ctx.save();
    ctx.scale(viewport.dpr, viewport.dpr);
    ctx.strokeStyle = selected ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    curve.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.stroke();
    ctx.restore();
  }

  function drawHandle(curve, pt, index) {
    ctx.save();
    ctx.scale(viewport.dpr, viewport.dpr);
    const selected = curve.id === state.selectedCurveId;
    const active = selected && state.selectedPointIndex === index;
    const offscreen = pt.x < 0 || pt.y < 0 || pt.x > viewport.w || pt.y > viewport.h;
    const r = active ? 6.5 : 5;
    ctx.beginPath();
    ctx.fillStyle = active ? '#ffd166' : curve.color;
    ctx.strokeStyle = '#0f1420';
    ctx.lineWidth = 2;
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (offscreen) {
      const cx = Math.max(12, Math.min(viewport.w - 12, pt.x));
      const cy = Math.max(12, Math.min(viewport.h - 12, pt.y));
      ctx.strokeStyle = '#ff6b6b';
      ctx.fillStyle = '#ff6b6b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      arrow(ctx, pt.x, pt.y, cx, cy);
    }
    ctx.restore();
  }

  function drawCurvatureComb(curve, tess) {
    if (!settings.comb || !tess || !tess.comb.length) return;
    const combHeight = 52;
    const maxK = tess.maxCurvature || 1e-9;
    const comb = tess.comb;
    const tips = comb.map((q, i) => {
      let tx = 0, ty = 0;
      if (i === 0) {
        tx = comb[1].px - q.px; ty = comb[1].py - q.py;
      } else if (i === comb.length - 1) {
        tx = q.px - comb[i - 1].px; ty = q.py - comb[i - 1].py;
      } else {
        tx = comb[i + 1].px - comb[i - 1].px; ty = comb[i + 1].py - comb[i - 1].py;
      }
      const tl = Math.hypot(tx, ty) || 1;
      const nx = -ty / tl, ny = tx / tl;
      const off = ((q.k || 0) / maxK) * combHeight;
      return { bx: q.px, by: q.py, x: q.px + nx * off, y: q.py + ny * off, k: q.k || 0 };
    });
    ctx.save();
    ctx.scale(viewport.dpr, viewport.dpr);
    ctx.lineWidth = 1;
    for (const tip of tips) {
      ctx.strokeStyle = tip.k >= 0 ? 'rgba(123,216,143,0.45)' : 'rgba(255,107,157,0.45)';
      ctx.beginPath();
      ctx.moveTo(tip.bx, tip.by);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
    }
    ctx.beginPath();
    tips.forEach((tip, i) => i ? ctx.lineTo(tip.x, tip.y) : ctx.moveTo(tip.x, tip.y));
    ctx.strokeStyle = 'rgba(215,125,255,0.75)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  function drawEvalOverlay(curve) {
    const t = settings.t;
    const f = BM.evalFull(curve.points, t);
    ctx.save();
    ctx.scale(viewport.dpr, viewport.dpr);
    const L = 46;
    const tl = Math.hypot(f.tangent.x, f.tangent.y);
    if (tl > 1e-9) {
      const ux = f.tangent.x / tl, uy = f.tangent.y / tl;
      ctx.strokeStyle = '#ffd166';
      ctx.fillStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(f.point.x - ux * L, f.point.y - uy * L);
      ctx.lineTo(f.point.x + ux * L, f.point.y + uy * L);
      ctx.stroke();
      arrow(ctx, f.point.x, f.point.y, f.point.x + ux * L, f.point.y + uy * L);
    }
    if (settings.osculating && isFinite(f.radius) && f.radius < 4000) {
      const nx = -f.tangent.y / (tl || 1), ny = f.tangent.x / (tl || 1);
      const cx = f.point.x + nx * (f.signedCurvature >= 0 ? f.radius : -f.radius);
      const cy = f.point.y + ny * (f.signedCurvature >= 0 ? f.radius : -f.radius);
      ctx.strokeStyle = 'rgba(92,225,230,0.8)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.min(f.radius, 4000), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#5ce1e6';
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#0f1420';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(f.point.x, f.point.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillText('P(' + t.toFixed(3) + ')', f.point.x + 10, f.point.y - 10);
    ctx.restore();
    return f;
  }

  function fmt(v, digits) {
    if (v == null || !isFinite(v)) return '∞';
    return Number(v).toFixed(digits == null ? 3 : digits);
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawGrid();
    let evalResult = null;
    for (const c of state.curves) {
      const tess = getTess(c);
      drawCurve(c, tess);
      if (tess) drawCurvatureComb(c, tess);
    }
    for (const c of state.curves) drawPolygon(c);
    for (const c of state.curves) {
      c.points.forEach((p, i) => drawHandle(c, p, i));
    }
    const sel = selectedCurve();
    if (sel) evalResult = drawEvalOverlay(sel);
    updateInfo(sel, evalResult);
    updateStatus();
  }

  function updateInfo(curve, f) {
    if (!curve) {
      dom.info.degree.textContent = '—';
      dom.info.points.textContent = '—';
      dom.info.segCount.textContent = '—';
      ['evalX', 'evalY', 'tangent', 'speed', 'curvature', 'radius'].forEach(k => dom.info[k].textContent = '—');
      return;
    }
    const degree = curve.points.length - 1;
    dom.info.degree.textContent = degree + (degree >= 40 ? ' ⚠' : '');
    dom.info.points.textContent = curve.points.length;
    const tess = getTess(curve);
    const seg = tess ? tess.poly.length - 1 : '…';
    dom.info.segCount.textContent = seg + (tess && tess.degraded ? ' (折线降级)' : '');
    if (f) {
      dom.info.evalX.textContent = fmt(f.point.x, 4);
      dom.info.evalY.textContent = fmt(f.point.y, 4);
      const deg = f.angle * 180 / Math.PI;
      dom.info.tangent.textContent = '(' + fmt(f.tangent.x, 4) + ', ' + fmt(f.tangent.y, 4) + ')  ' + deg.toFixed(2) + '°';
      dom.info.speed.textContent = fmt(f.speed, 6);
      dom.info.curvature.textContent = fmt(f.curvature, 8) + ' (有符号 ' + fmt(f.signedCurvature, 8) + ')';
      dom.info.radius.textContent = isFinite(f.radius) ? fmt(f.radius, 4) : '∞';
    }
  }

  function updateStatus() {
    const parts = [];
    parts.push(state.curves.length + ' 条曲线');
    const high = state.curves.filter(c => c.points.length - 1 >= 40);
    if (high.length) parts.push('⚠ 高阶曲线 ' + high.length + ' 条（折线近似）');
    const oob = state.curves.reduce((n, c) => n + c.points.filter(p => p.x < 0 || p.y < 0 || p.x > viewport.w || p.y > viewport.h).length, 0);
    if (oob) parts.push('控制点越界 ' + oob + ' 个' + (settings.clamp ? '（已钳制）' : ''));
    if (!workerSupported) parts.push('Worker 不可用：主线程降级');
    dom.status.textContent = parts.join(' · ');
  }

  function updateButtons() {
    const c = selectedCurve();
    dom.undo.disabled = !undoStack.length;
    dom.redo.disabled = !redoStack.length;
    dom.addPoint.disabled = !c && !state.curves.length;
    dom.deletePoint.disabled = !c;
    dom.elevate.disabled = !c;
    dom.reduce.disabled = !c || c.points.length - 1 < 2;
    dom.split.disabled = !c;
    const selCount = state.curves.filter(x => x._selected).length;
    dom.merge.disabled = selCount !== 2;
    if (c && c.points.length - 1 >= MAX_DEGREE) {
      dom.elevate.disabled = true;
      dom.addPoint.disabled = true;
    }
  }

  function runSelfTests() {
    const results = window.BezierSelfTest.run();
    dom.testResults.innerHTML = '';
    for (const r of results) {
      const div = document.createElement('div');
      div.className = 'test-line ' + (r.pass ? 'pass' : 'fail');
      div.textContent = (r.pass ? '✓ ' : '✗ ') + r.name + (r.detail ? ' — ' + r.detail : '');
      dom.testResults.appendChild(div);
    }
    const failed = results.filter(r => !r.pass).length;
    toastMessage(failed ? failed + ' 项自检失败' : '全部 ' + results.length + ' 项自检通过', failed ? 'warn' : '');
  }

  function bindEvents() {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('contextmenu', ev => ev.preventDefault());

    dom.addPoint.addEventListener('click', cmdAddPoint);
    dom.deletePoint.addEventListener('click', cmdDeletePoint);
    dom.elevate.addEventListener('click', cmdElevate);
    dom.reduce.addEventListener('click', cmdReduce);
    dom.split.addEventListener('click', cmdSplit);
    dom.merge.addEventListener('click', cmdMerge);
    dom.clear.addEventListener('click', cmdClear);
    dom.reset.addEventListener('click', cmdReset);
    dom.undo.addEventListener('click', undo);
    dom.redo.addEventListener('click', redo);
    dom.selfTest.addEventListener('click', runSelfTests);

    dom.tRange.addEventListener('input', () => {
      settings.t = parseFloat(dom.tRange.value);
      dom.tValue.textContent = settings.t.toFixed(3);
      render();
      schedulePersist();
    });
    dom.clampPoints.addEventListener('change', () => {
      settings.clamp = dom.clampPoints.checked;
      if (settings.clamp) {
        for (const c of state.curves) c.points = c.points.map(clampPoint);
        invalidateAll();
      }
      render();
      schedulePersist();
    });
    dom.showPolygon.addEventListener('change', () => { settings.polygon = dom.showPolygon.checked; render(); schedulePersist(); });
    dom.showComb.addEventListener('change', () => { settings.comb = dom.showComb.checked; render(); schedulePersist(); });
    dom.showOsculating.addEventListener('change', () => { settings.osculating = dom.showOsculating.checked; render(); schedulePersist(); });

    window.addEventListener('keydown', ev => {
      const tag = (ev.target && ev.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) redo(); else undo();
      } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') {
        ev.preventDefault();
        redo();
      } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault();
        cmdDeletePoint();
      } else if (ev.key === '+' || ev.key === '=') {
        cmdElevate();
      } else if (ev.key === '-') {
        cmdReduce();
      } else if (ev.key.toLowerCase() === 's') {
        cmdSplit();
      }
    });

    let resizeT = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(resizeCanvas, 60);
    });
  }

  function syncSettingsUI() {
    dom.tRange.value = String(settings.t);
    dom.tValue.textContent = settings.t.toFixed(3);
    dom.clampPoints.checked = !!settings.clamp;
    dom.showPolygon.checked = !!settings.polygon;
    dom.showComb.checked = !!settings.comb;
    dom.showOsculating.checked = !!settings.osculating;
  }

  function boot() {
    initWorker();
    bindEvents();
    syncSettingsUI();
    resizeCanvas();
    restore().then(() => {
      syncSettingsUI();
      updateButtons();
      invalidateAll();
      render();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
