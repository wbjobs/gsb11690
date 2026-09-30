import { WORLD } from './model.js';

const GRID_SIZE = 50;

export function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return {
    dpr,
    cssWidth: rect.width,
    cssHeight: rect.height,
  };
}

export function fitCamera(width, height) {
  const padding = 70;
  const zoom = Math.min(
    (width - padding * 2) / (WORLD.maxX - WORLD.minX),
    (height - padding * 2) / (WORLD.maxY - WORLD.minY),
  );
  return {
    zoom: Math.max(0.25, zoom),
    x: (width - (WORLD.maxX - WORLD.minX) * zoom) / 2 - WORLD.minX * zoom,
    y: (height - (WORLD.maxY - WORLD.minY) * zoom) / 2 - WORLD.minY * zoom,
  };
}

export function screenToWorld(event, canvas, camera) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - camera.x) / camera.zoom,
    y: (event.clientY - rect.top - camera.y) / camera.zoom,
  };
}

export function zoomAt(camera, screenX, screenY, nextZoom) {
  const zoom = clampZoom(nextZoom);
  const worldX = (screenX - camera.x) / camera.zoom;
  const worldY = (screenY - camera.y) / camera.zoom;
  return {
    zoom,
    x: screenX - worldX * zoom,
    y: screenY - worldY * zoom,
  };
}

export function clampZoom(zoom) {
  return Math.min(8, Math.max(0.12, zoom));
}

export function render(parameters) {
  const {
    ctx,
    canvas,
    document,
    selected,
    samples,
    camera,
    draftSamples,
    overlay,
    hover,
    addMode,
    drag,
  } = parameters;
  const { dpr, cssWidth, cssHeight } = resizeCanvas(canvas);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  drawBackground(ctx, cssWidth, cssHeight);

  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);
  drawGrid(ctx, cssWidth, cssHeight, camera);
  drawWorldBounds(ctx, camera.zoom);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const curve of document.curves) {
    const active = selected.includes(curve.id);
    const pathPoints =
      (drag && drag.curveId === curve.id && draftSamples) ||
      samples.get(curve.id) ||
      curve.points;
    drawCurve(
      ctx,
      curve,
      pathPoints,
      active,
      Boolean(drag && drag.curveId === curve.id),
      camera.zoom,
    );
  }

  for (const curve of document.curves) {
    drawControlPolygon(
      ctx,
      curve,
      selected.includes(curve.id),
      hover,
      drag,
      camera.zoom,
    );
  }

  if (overlay) drawOverlay(ctx, overlay, document, camera.zoom);
  ctx.restore();

  drawModeHint(ctx, addMode, cssWidth);
}

function drawBackground(ctx, width, height) {
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, height);
}

function drawGrid(ctx, width, height, camera) {
  const worldLeft = -camera.x / camera.zoom;
  const worldTop = -camera.y / camera.zoom;
  const worldRight = (width - camera.x) / camera.zoom;
  const worldBottom = (height - camera.y) / camera.zoom;
  const firstX = Math.floor(worldLeft / GRID_SIZE) * GRID_SIZE;
  const firstY = Math.floor(worldTop / GRID_SIZE) * GRID_SIZE;

  ctx.lineWidth = 1 / camera.zoom;
  ctx.strokeStyle = '#e2e8f0';
  ctx.beginPath();
  for (let x = firstX; x <= worldRight; x += GRID_SIZE) {
    ctx.moveTo(x, worldTop);
    ctx.lineTo(x, worldBottom);
  }
  for (let y = firstY; y <= worldBottom; y += GRID_SIZE) {
    ctx.moveTo(worldLeft, y);
    ctx.lineTo(worldRight, y);
  }
  ctx.stroke();
}

function drawWorldBounds(ctx, zoom) {
  ctx.save();
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.setLineDash([10 / zoom, 8 / zoom]);
  ctx.strokeRect(WORLD.minX, WORLD.minY, WORLD.maxX - WORLD.minX, WORLD.maxY - WORLD.minY);
  ctx.restore();
}

function drawCurve(ctx, curve, pathPoints, active, dragging, zoom) {
  if (pathPoints.length < 2) return;
  ctx.save();
  ctx.strokeStyle = curve.color;
  ctx.globalAlpha = dragging ? 0.78 : 0.95;
  ctx.lineWidth = (active ? 4.2 : 3) / zoom;
  ctx.shadowColor = active ? 'rgba(15, 23, 42, 0.18)' : 'transparent';
  ctx.shadowBlur = active ? 5 : 0;
  tracePath(ctx, pathPoints);
  ctx.stroke();
  ctx.restore();
}

function drawControlPolygon(ctx, curve, active, hover, drag, zoom) {
  ctx.save();
  ctx.strokeStyle = active ? curve.color : '#64748b';
  ctx.fillStyle = active ? curve.color : '#64748b';
  ctx.globalAlpha = active ? 0.72 : 0.46;
  ctx.lineWidth = 1.4 / zoom;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  curve.points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  curve.points.forEach((point, index) => {
    const isHover =
      hover && hover.curveId === curve.id && hover.pointIndex === index;
    const isDrag =
      drag && drag.curveId === curve.id && drag.pointIndex === index;
    const radius = (isHover || isDrag ? 7 : active ? 5.8 : 4.6) / zoom;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = (isHover || isDrag ? 3 : 2) / zoom;
    ctx.strokeStyle = active ? curve.color : '#475569';
    ctx.stroke();

    if (active) {
      ctx.font = `${12 / zoom}px system-ui, sans-serif`;
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      const label = `P${index}`;
      ctx.strokeText(label, point.x + 8, point.y - 8);
      ctx.fillText(label, point.x + 8, point.y - 8);
    }
  });
  ctx.restore();
}

function drawOverlay(ctx, overlay, document, zoom) {
  const curve = document.curves.find((item) => item.id === overlay.curveId);
  if (!curve) return;

  const { point, tangent: unitTangent, curvature: curvatureInfo } = overlay;
  ctx.save();

  if (
    Number.isFinite(curvatureInfo.radius) &&
    curvatureInfo.value > 1e-8 &&
    curvatureInfo.radius <= 1600
  ) {
    const radius = curvatureInfo.radius;
    const nx = -unitTangent.y;
    const ny = unitTangent.x;
    const center = {
      x: point.x + nx * radius * Math.sign(curvatureInfo.signed || 1),
      y: point.y + ny * radius * Math.sign(curvatureInfo.signed || 1),
    };
    ctx.strokeStyle = 'rgba(124, 58, 237, 0.72)';
    ctx.lineWidth = 1.6 / zoom;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#7c3aed';
    ctx.beginPath();
    ctx.arc(center.x, center.y, 3 / zoom, 0, Math.PI * 2);
    ctx.fill();
  }

  const arrowLength = 70;
  const end = {
    x: point.x + unitTangent.x * arrowLength,
    y: point.y + unitTangent.y * arrowLength,
  };
  ctx.strokeStyle = '#0f766e';
  ctx.fillStyle = '#0f766e';
  ctx.lineWidth = 2.5 / zoom;
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  drawArrowHead(ctx, point, end, zoom);

  ctx.fillStyle = '#ef4444';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3 / zoom;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 6.5 / zoom, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3 / zoom;
  ctx.stroke();
  ctx.restore();
}

function drawArrowHead(ctx, start, end, zoom) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(
    end.x - (12 / zoom) * Math.cos(angle - Math.PI / 6),
    end.y - (12 / zoom) * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    end.x - (12 / zoom) * Math.cos(angle + Math.PI / 6),
    end.y - (12 / zoom) * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

function tracePath(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y);
  }
}

function drawModeHint(ctx, addMode, width) {
  if (!addMode) return;
  ctx.save();
  ctx.font = '600 13px system-ui, sans-serif';
  const text = '添加模式：点击空白处追加/新建控制点，按 Esc 退出';
  const paddingX = 12;
  const widthText = ctx.measureText(text).width + paddingX * 2;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
  roundedRect(ctx, width / 2 - widthText / 2, 14, widthText, 34, 8);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, width / 2 - widthText / 2 + paddingX, 36);
  ctx.restore();
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

export function distanceToPolyline(point, polyline) {
  let best = Infinity;
  for (let i = 1; i < polyline.length; i += 1) {
    best = Math.min(best, distanceToSegment(point, polyline[i - 1], polyline[i]));
  }
  return best;
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return Math.hypot(point.x - start.x, point.y - start.y);
  const u = Math.min(
    1,
    Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  const x = start.x + u * dx;
  const y = start.y + u * dy;
  return Math.hypot(point.x - x, point.y - y);
}
