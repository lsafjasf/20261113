export function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || canvas.width;
  const h = rect.height || canvas.height;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

export function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export const COLORS = {
  grid: 'rgba(110, 190, 150, 0.16)',
  gridStrong: 'rgba(110, 190, 150, 0.3)',
  green: '#7fe0a8',
  cyan: '#6fe3e0',
  amber: '#f2b66b',
  red: '#ef7a72',
  text: '#9fc3bb',
  dim: '#4d6a68',
};
