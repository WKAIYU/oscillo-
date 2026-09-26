export const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

export function fmtTime(t) {
  if (!isFinite(t) || t < 0) return '--:--';
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

export function fmtSampleRate(hz) {
  if (!hz || hz <= 0) return '--';
  return hz % 1000 === 0 ? (hz / 1000) + 'k' : (hz / 1000).toFixed(1) + 'k';
}

export function fmtMs(ms) {
  if (ms < 1) return (ms * 1000).toFixed(0) + ' µs';
  if (ms < 10) return ms.toFixed(2) + ' ms';
  return ms.toFixed(1) + ' ms';
}

export function colorStr([r, g, b, a]) {
  return `rgba(${r * 255 | 0},${g * 255 | 0},${b * 255 | 0},${a})`;
}