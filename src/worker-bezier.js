import { sampleAdaptive, sampleUniform } from './math.js';

const pending = new Map();
let sequence = 0;

self.onmessage = (event) => {
  const { type } = event.data || {};
  if (type === 'cancel') {
    pending.delete(event.data.key);
    return;
  }
  if (type !== 'sample') return;

  const { curves, mode, key, requestId } = event.data;
  const id = ++sequence;
  pending.set(key, id);

  queueMicrotask(() => {
    if (pending.get(key) !== id) return;
    const samples = curves.map((curve) => {
      const degree = curve.points.length - 1;
      if (mode === 'draft' || degree >= 16) {
        const segments = mode === 'draft' ? Math.min(48, degree * 3) : 160;
        return sampleUniform(curve.points, segments);
      }
      return sampleAdaptive(curve.points, 0.55, 16);
    });
    if (pending.get(key) !== id) return;
    pending.delete(key);
    self.postMessage({ type: 'samples', key, requestId, samples });
  });
};
