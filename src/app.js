import {
  WORLD,
  addPoint,
  commitHistory,
  createHistory,
  createInitialDocument,
  deletePoint,
  lowerSelected,
  mergeSelected,
  movePoint,
  raiseSelected,
  redoHistory,
  sanitizeDocument,
  splitSelected,
  undoHistory,
  validateSelection,
} from './model.js';
import {
  curvature,
  derivative,
  evaluate,
  isInside,
  sampleUniform,
  tangent,
} from './math.js';
import { loadDocument, saveDocument } from './storage.js';
import {
  distanceToPolyline,
  fitCamera,
  render,
  screenToWorld,
  zoomAt,
} from './renderer.js';

const canvas = document.querySelector('#canvas');
const ctx = canvas.getContext('2d');
const elements = getElements();
let history = createHistory(createInitialDocument());
let selected = [];
let activePoint = null;
let addMode = false;
let hover = null;
let drag = null;
let pan = null;
let camera = { zoom: 1, x: 0, y: 0 };
let samples = new Map();
let draftSamples = null;
let overlay = null;
let worker = null;
let activeRequest = 0;
let saveTimer = 0;
let saveToken = 0;
let statusTimer = 0;
let needsRender = true;

init().catch((error) => showStatus(error.message, 'error'));
requestAnimationFrame(frame);

async function init() {
  const loaded = await loadDocument();
  history = createHistory(sanitizeDocument(loaded.document));
  selected = [document().curves[0]?.id].filter(Boolean);
  camera = fitCamera(canvas.clientWidth, canvas.clientHeight);
  showStatus(
    loaded.source === 'default'
      ? '已创建示例曲线'
      : `已从 ${loaded.source === 'indexeddb' ? 'IndexedDB' : 'localStorage'} 恢复`,
    'ok',
  );
  bindEvents();
  updateOverlay();
  requestSamples(false);
  scheduleSave();
  updateUi();
}

function getElements() {
  return Object.fromEntries(
    [
      'addPoint',
      'deletePoint',
      'raiseDegree',
      'lowerDegree',
      'splitCurve',
      'mergeCurves',
      'splitT',
      'evalT',
      'metricDegree',
      'metricPoint',
      'metricTangent',
      'metricDerivative',
      'metricCurvature',
      'metricRadius',
      'undo',
      'red',
      'resetView',
      'saveState',
      'status',
    ].map((id) => [id, document.querySelector(`#${id}`)]),
  );
}

function bindEvents() {
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', () => {
    hover = null;
    needsRender = true;
  });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  elements.addPoint.addEventListener('click', () => {
    addMode = !addMode;
    showStatus(addMode ? '点击曲线末端附近可追加；点击空白处新建曲线' : '已退出添加模式', 'ok');
    updateUi();
  });
  elements.deletePoint.addEventListener('click', deleteActivePoint);
  elements.raiseDegree.addEventListener('click', () =>
    runCommand((doc) => raiseSelected(doc, requireSingleSelection()), '已升阶'),
  );
  elements.lowerDegree.addEventListener('click', () => {
    const curveId = requireSingleSelection();
    runCommand((doc) => {
      const result = lowerSelected(doc, curveId);
      queueStatus(
        result.exact
          ? '降阶精确完成'
          : `降阶为最小二乘近似，最大偏差 ${result.error.toFixed(3)}px`,
        result.exact ? 'ok' : 'warn',
      );
      return result.document;
    }, '');
  });
  elements.splitCurve.addEventListener('click', () => {
    const curveId = requireSingleSelection();
    runCommand(
      (doc) => {
        const t = readUnit(elements.splitT, 0.5, true);
        const result = splitSelected(doc, curveId, t);
        selected = result.ids;
        queueStatus(`已在 t=${t.toFixed(3)} 分割，可直接合并还原`, 'ok');
        return result.document;
      },
      '',
    );
  });
  elements.mergeCurves.addEventListener('click', () => {
    const ids = selected;
    runCommand(
      (doc) => {
        const result = mergeSelected(doc, ids);
        selected = [result.id];
        queueStatus(
          result.exact
            ? '两条曲线已精确合并'
            : `已近似合并，最大偏差 ${result.error.toFixed(3)}px`,
          result.exact ? 'ok' : 'warn',
        );
        return result.document;
      },
      '',
    );
  });
  elements.undo.addEventListener('click', applyUndo);
  elements.red.addEventListener('click', applyRedo);
  elements.resetView.addEventListener('click', () => {
    camera = fitCamera(canvas.clientWidth, canvas.clientHeight);
    needsRender = true;
  });
  elements.evalT.addEventListener('input', () => {
    updateOverlay();
    updateUi();
  });
  elements.splitT.addEventListener('input', updateUi);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', () => {
    camera = fitCamera(canvas.clientWidth, canvas.clientHeight);
    needsRender = true;
  });

  if ('Worker' in window) {
    worker = new Worker(new URL('./worker-bezier.js', import.meta.url), { type: 'module' });
    worker.onmessage = onWorkerMessage;
    worker.onerror = (error) => {
      console.warn('Web Worker 不可用，改用主线程采样', error);
      worker = null;
      requestSamples(Boolean(drag));
    };
  }
}

function document() {
  return history.current;
}

function frame() {
  if (needsRender) {
    render({
      ctx,
      canvas,
      document: document(),
      selected,
      samples,
      draftSamples,
      camera,
      overlay,
      hover,
      addMode,
      drag,
    });
    needsRender = false;
  }
  requestAnimationFrame(frame);
}

function onPointerDown(event) {
  canvas.focus?.();
  canvas.setPointerCapture?.(event.pointerId);
  const world = screenToWorld(event, canvas, camera);
  const hitPoint = findPoint(world, 10 / camera.zoom);

  if (hitPoint) {
    if (addMode) {
      addMode = false;
    }
    if (!selected.includes(hitPoint.curveId) && !(event.ctrlKey || event.metaKey || event.shiftKey)) {
      selected = [hitPoint.curveId];
      activePoint = hitPoint;
    } else if (event.ctrlKey || event.metaKey || event.shiftKey) {
      selected = selected.includes(hitPoint.curveId)
        ? selected.filter((id) => id !== hitPoint.curveId)
        : [...selected, hitPoint.curveId];
      activePoint = selected.includes(hitPoint.curveId) ? hitPoint : null;
    } else {
      activePoint = hitPoint;
    }

    if (activePoint) {
      const curve = getCurve(activePoint.curveId);
      drag = {
        ...activePoint,
        start: { ...curve.points[activePoint.pointIndex] },
        snapshot: history.current,
        pointerId: event.pointerId,
        moved: false,
      };
      draftSamples = createDraftSamples(document());
    }
    updateOverlay();
    updateUi();
    needsRender = true;
    return;
  }

  if (addMode) {
    handleAddPoint(world);
    return;
  }

  const hitCurve = findCurve(world, 8 / camera.zoom);
  if (hitCurve && event.altKey) {
    const closest = closestParameter(world, getCurve(hitCurve));
    selected = [hitCurve];
    elements.splitT.value = closest.toFixed(3);
    try {
      handleCommand((doc) => {
        const result = splitSelected(doc, hitCurve, closest);
        selected = result.ids;
        return result.document;
      }, '已在点击处分割');
    } catch (error) {
      showStatus(error.message, 'error');
    }
    return;
  }

  if (hitCurve && (event.ctrlKey || event.metaKey || event.shiftKey)) {
    selected = selected.includes(hitCurve)
      ? selected.filter((id) => id !== hitCurve)
      : [...selected, hitCurve];
  } else if (hitCurve) {
    selected = [hitCurve];
  } else if (event.button === 2 || event.button === 1) {
    pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera: { ...camera } };
  } else {
    selected = [];
    pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera: { ...camera } };
  }
  activePoint = null;
  updateOverlay();
  updateUi();
  needsRender = true;
}

function onPointerMove(event) {
  const world = screenToWorld(event, canvas, camera);

  if (pan && pan.pointerId === event.pointerId) {
    camera = {
      ...pan.camera,
      x: pan.camera.x + event.clientX - pan.x,
      y: pan.camera.y + event.clientY - pan.y,
    };
    needsRender = true;
    return;
  }

  if (drag && drag.pointerId === event.pointerId) {
    const inside = isInside(world, WORLD);
    if (!inside && !drag.warned) {
      showStatus('控制点不能越界，已自动吸附到画布边界', 'warn');
      drag.warned = true;
    }
    const curve = getCurve(drag.curveId);
    const current = curve.points[drag.pointIndex];
    if (Math.hypot(current.x - world.x, current.y - world.y) > 0.01) drag.moved = true;
    history.current = movePoint(history.current, drag.curveId, drag.pointIndex, world);
    updateDraftSample(history.current, drag.curveId);
    updateOverlay();
    updateMetricsOnly();
    needsRender = true;
    return;
  }

  hover = findPoint(world, 10 / camera.zoom);
  canvas.style.cursor = hover ? 'grab' : addMode ? 'copy' : findCurve(world, 8 / camera.zoom) ? 'pointer' : 'default';
  needsRender = true;
}

function onPointerUp(event) {
  if (pan && pan.pointerId === event.pointerId) pan = null;

  if (drag && drag.pointerId === event.pointerId) {
    if (drag.moved) {
      history = {
        undo: [...history.undo.slice(-99), drag.snapshot],
        redo: [],
        current: history.current,
      };
      scheduleSave();
      requestSamples(false);
    }
    drag = null;
    draftSamples = null;
    updateUi();
    needsRender = true;
  }
}

function onWheel(event) {
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  const rect = canvas.getBoundingClientRect();
  camera = zoomAt(
    camera,
    event.clientX - rect.left,
    event.clientY - rect.top,
    camera.zoom * factor,
  );
  needsRender = true;
}

function onKeyDown(event) {
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey) {
    event.preventDefault();
    applyUndo();
  } else if ((event.ctrlKey || event.metaKey) && (key === 'y' || (key === 'z' && event.shiftKey))) {
    event.preventDefault();
    applyRedo();
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && activePoint) {
    event.preventDefault();
    deleteActivePoint();
  } else if (event.key === 'Escape') {
    addMode = false;
    activePoint = null;
    updateUi();
    needsRender = true;
  }
}

function handleAddPoint(world) {
  if (!isInside(world, WORLD)) {
    showStatus('控制点越界：只能在虚线工作区内添加控制点', 'error');
    return;
  }
  handleCommand((doc) => {
    const curveId = selected[selected.length - 1] ?? null;
    const result = addPoint(doc, curveId, world);
    selected = [result.curveId];
    return result.document;
  }, '已添加控制点');
}

function deleteActivePoint() {
  if (!activePoint) {
    showStatus('请先点击一个控制点', 'warn');
    return;
  }
  const { curveId, pointIndex } = activePoint;
  handleCommand((doc) => {
    const result = deletePoint(doc, curveId, pointIndex);
    if (result.removedCurve) selected = selected.filter((id) => id !== curveId);
    activePoint = null;
    return result.document;
  }, '已删除控制点');
}

function runCommand(updater, successMessage) {
  try {
    handleCommand(updater, successMessage);
  } catch (error) {
    showStatus(error.message, 'error');
  }
}

function handleCommand(updater, successMessage) {
  try {
    const next = updater(history.current);
    if (next !== history.current) {
      history = commitHistory(history, next);
      selected = validateSelection(history.current, selected);
      afterMutation();
    }
    if (successMessage) showStatus(successMessage, 'ok');
  } catch (error) {
    showStatus(error.message, 'error');
    throw error;
  }
}

function afterMutation() {
  activePoint = null;
  samples = new Map();
  draftSamples = drag ? createDraftSamples(document()) : null;
  updateOverlay();
  updateUi();
  requestSamples(Boolean(drag));
  scheduleSave();
  needsRender = true;
}

function applyUndo() {
  const previous = undoHistory(history);
  if (previous === history) {
    showStatus('没有可撤销的操作', 'warn');
    return;
  }
  history = previous;
  activePoint = null;
  drag = null;
  draftSamples = null;
  selected = validateSelection(document(), selected);
  afterMutation();
  showStatus('已撤销', 'ok');
}

function applyRedo() {
  const next = redoHistory(history);
  if (next === history) {
    showStatus('没有可重做的操作', 'warn');
    return;
  }
  history = next;
  activePoint = null;
  drag = null;
  draftSamples = null;
  selected = validateSelection(document(), selected);
  afterMutation();
  showStatus('已重做', 'ok');
}

function queueStatus(message, type = 'ok') {
  setTimeout(() => showStatus(message, type), 0);
}

function showStatus(message, type = 'ok') {
  clearTimeout(statusTimer);
  elements.status.textContent = message;
  elements.status.className = `status show ${type === 'ok' ? '' : type}`;
  statusTimer = setTimeout(() => {
    elements.status.classList.remove('show');
  }, 3200);
}

function getCurve(curveId) {
  return document().curves.find((curve) => curve.id === curveId);
}

function requireSingleSelection() {
  if (selected.length !== 1) throw new Error('请选择一条曲线');
  return selected[0];
}

function findPoint(world, radius) {
  let best = null;
  let bestDistance = radius;
  for (const curve of document().curves) {
    curve.points.forEach((point, pointIndex) => {
      const distance = Math.hypot(point.x - world.x, point.y - world.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { curveId: curve.id, pointIndex };
      }
    });
  }
  return best;
}

function findCurve(world, tolerance) {
  let best = null;
  let bestDistance = tolerance;
  for (const curve of document().curves) {
    const polyline = samples.get(curve.id) || sampleUniform(curve.points, 80);
    const distance = distanceToPolyline(world, polyline);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = curve.id;
    }
  }
  return best;
}

function closestParameter(world, curve) {
  let best = 0.5;
  let bestDistance = Infinity;
  for (let i = 1; i < 100; i += 1) {
    const t = i / 100;
    const point = evaluate(curve.points, t);
    const distance = Math.hypot(point.x - world.x, point.y - world.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = t;
    }
  }
  return best;
}

function createDraftSamples(doc) {
  const map = new Map();
  for (const curve of doc.curves) {
    map.set(curve.id, sampleUniform(curve.points, 24));
  }
  return map;
}

function updateDraftSample(doc, curveId) {
  if (!draftSamples) draftSamples = createDraftSamples(doc);
  const curve = doc.curves.find((item) => item.id === curveId);
  if (curve) draftSamples.set(curveId, sampleUniform(curve.points, 24));
}

function requestSamples(draft) {
  const curves = document().curves.map((curve) => ({
    id: curve.id,
    points: curve.points,
  }));
  activeRequest += 1;
  const requestId = activeRequest;

  if (!worker || draft || curves.some((curve) => curve.points.length > 25)) {
    const map = createDraftSamples(document());
    samples = map;
    needsRender = true;
    return requestId;
  }

  worker.postMessage({
    type: 'sample',
    key: 'document',
    requestId,
    curves,
    mode: 'quality',
  });
  return requestId;
}

function onWorkerMessage(event) {
  if (event.data.type !== 'samples') return;
  if (event.data.requestId !== activeRequest) return;
  samples = new Map();
  event.data.samples.forEach((polyline, index) => {
    const curve = document().curves[index];
    if (curve) samples.set(curve.id, polyline);
  });
  needsRender = true;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  const token = ++saveToken;
  saveTimer = setTimeout(async () => {
    elements.saveState.textContent = '保存中…';
    elements.saveState.className = 'save-state';
    try {
      const source = await saveDocument(document());
      if (token !== saveToken) return;
      elements.saveState.textContent = source === 'memory' ? '仅内存' : '已自动保存';
      elements.saveState.className = `save-state ${source === 'memory' ? 'error' : 'ok'}`;
    } catch (error) {
      elements.saveState.textContent = '保存降级';
      elements.saveState.className = 'save-state error';
    }
  }, 250);
}

function readUnit(input, fallback, strict = false) {
  const value = Number.parseFloat(input.value);
  if (!Number.isFinite(value)) return fallback;
  if (strict && (value <= 0 || value >= 1)) {
    throw new Error('参数必须满足 0 < t < 1');
  }
  return Math.min(1, Math.max(0, value));
}

function updateOverlay() {
  const curveId = selected[selected.length - 1];
  const curve = curveId ? getCurve(curveId) : null;
  if (!curve) {
    overlay = null;
    return;
  }
  const t = readUnit(elements.evalT, 0.5);
  overlay = {
    curveId,
    t,
    point: evaluate(curve.points, t),
    tangent: tangent(curve.points, t),
    curvature: curvature(curve.points, t),
    derivative: derivative(curve.points, t),
  };
}

function updateUi() {
  updateOverlay();
  updateMetricsOnly();
  const one = selected.length === 1;
  const two = selected.length === 2;
  const curve = one ? getCurve(selected[0]) : null;
  const degree = curve ? curve.points.length - 1 : null;
  elements.addPoint.classList.toggle('primary', addMode);
  elements.addPoint.textContent = addMode ? '退出添加' : '添加控制点';
  elements.deletePoint.disabled = !activePoint;
  elements.raiseDegree.disabled = !curve || degree >= 24;
  elements.lowerDegree.disabled = !curve || degree <= 1;
  elements.splitCurve.disabled = !one;
  elements.mergeCurves.disabled = !two;
  elements.undo.disabled = !history.undo.length;
  elements.red.disabled = !history.redo.length;
}

function updateMetricsOnly() {
  if (!overlay) {
    elements.metricDegree.textContent = '-';
    elements.metricPoint.textContent = '-';
    elements.metricTangent.textContent = '-';
    elements.metricDerivative.textContent = '-';
    elements.metricCurvature.textContent = '-';
    elements.metricRadius.textContent = '-';
    return;
  }
  const curve = getCurve(overlay.curveId);
  const format = (value) =>
    Math.abs(value) < 1e-10 ? '0.0000' : value.toFixed(4);
  elements.metricDegree.textContent = `${curve.points.length - 1}（${curve.points.length} 个控制点）`;
  elements.metricPoint.textContent = `(${format(overlay.point.x)}, ${format(overlay.point.y)})`;
  elements.metricTangent.textContent = `(${format(overlay.tangent.x)}, ${format(overlay.tangent.y)})`;
  elements.metricDerivative.textContent = `(${format(overlay.derivative.x)}, ${format(overlay.derivative.y)})`;
  elements.metricCurvature.textContent = `${format(overlay.curvature.signed)} / ${format(overlay.curvature.value)}`;
  elements.metricRadius.textContent = Number.isFinite(overlay.curvature.radius)
    ? format(overlay.curvature.radius)
    : '∞（直线/零速度）';
}
