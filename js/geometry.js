(function (root) {
  'use strict';

  function distanceToSegmentSq(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    const ex = px - cx, ey = py - cy;
    return ex * ex + ey * ey;
  }

  function distanceToPolyline(px, py, poly) {
    let best = Infinity;
    for (let i = 1; i < poly.length; i++) {
      const d = distanceToSegmentSq(px, py, poly[i - 1].x, poly[i - 1].y, poly[i].x, poly[i].y);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  function pointInRect(px, py, r, pad) {
    const p = pad || 0;
    return px >= r.minX - p && px <= r.maxX + p && py >= r.minY - p && py <= r.maxY + p;
  }

  function boundsIntersect(a, b) {
    return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
  }

  root.Geometry = { distanceToSegmentSq, distanceToPolyline, pointInRect, boundsIntersect };
})(typeof self !== 'undefined' ? self : this);
