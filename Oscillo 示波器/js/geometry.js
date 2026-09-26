// 从音频数据生成渲染批次
// 批次结构：{ type: 'lines'|'dots', data: Float32Array, width?|size?, color: [r,g,b,a] }
//
// lines data: 每段 4 个 float [x0,y0,x1,y1]
// dots  data: 每个 2 个 float [x,y]，size 在批次上

import { state, useXyLut, useYtLut } from './state.js';
import { clamp } from './utils.js';

const COLOR_GLOW = [58 / 255, 255 / 255, 165 / 255, 0.30];
const COLOR_MAIN = [200 / 255, 255 / 255, 226 / 255, 0.95];
const COLOR_HEAD = [1, 1, 1, 1];

function getAmps(physW, physH) {
  const halfW = physW / 2, halfH = physH / 2;
  const { equalAspect, vGain } = state;
  if (equalAspect) {
    const unit = Math.min(halfW, halfH) * 0.92;
    return { ampX: unit * vGain, ampY: unit * vGain, halfW, halfH };
  }
  return { ampX: halfW * vGain * 0.92, ampY: halfH * vGain * 0.92, halfW, halfH };
}

/** Y-T 时域波形 */
export function buildYT(buf, audioSampleRate, ytLut) {
  const { W, H, DPR, timebaseMs, vGain, trigLevel, glow, lineWidth } = state;
  const len = buf.length;
  const win = clamp(Math.round((timebaseMs * 10 / 1000) * audioSampleRate), 16, len);

  // 边缘触发
  let trig = -1;
  const searchEnd = len - win;
  for (let i = 1; i < searchEnd; i++) {
    if (buf[i - 1] < trigLevel && buf[i] >= trigLevel) { trig = i; break; }
  }
  if (trig < 0) for (let i = 1; i < searchEnd; i++) {
    if (buf[i - 1] < 0 && buf[i] >= 0) { trig = i; break; }
  }
  if (trig < 0) trig = 0;

  const pts = Math.max(2, Math.round(W * 2));
  const physW = W * DPR, physH = H * DPR;
  const amp = (physH / 2) * vGain;
  const useLut = useYtLut();
  if (useLut) ytLut.rebuild(pts, win);

  const segCount = pts - 1;
  const lines = new Float32Array(segCount * 4);
  let px = 0, py = 0;
  for (let i = 0; i < pts; i++) {
    let v;
    if (useLut) {
      v = buf[trig + ytLut.i0[i]] * (1 - ytLut.f[i]) + buf[trig + ytLut.i1[i]] * ytLut.f[i];
    } else {
      const t = (i / (pts - 1)) * (win - 1);
      const i0 = t | 0;
      const i1 = i0 + 1 < win ? i0 + 1 : i0;
      const f = t - i0;
      v = buf[trig + i0] * (1 - f) + buf[trig + i1] * f;
    }
    const x = (i / (pts - 1)) * physW;
    const y = physH * 0.5 - v * amp;
    if (i === 0) { px = x; py = y; continue; }
    const o = (i - 1) * 4;
    lines[o] = px; lines[o + 1] = py; lines[o + 2] = x; lines[o + 3] = y;
    px = x; py = y;
  }

  const batches = [];
  if (glow) batches.push({ type: 'lines', data: lines, width: lineWidth * 2.5 * DPR, color: COLOR_GLOW });
  batches.push({ type: 'lines', data: lines, width: lineWidth * DPR, color: COLOR_MAIN });
  return batches;
}

/** X-Y 矢量折线 */
export function buildXYVector(bufL, bufR, xyLut) {
  const { W, H, DPR, glow, lineWidth } = state;
  const n = Math.min(bufL.length, 8192);
  const physW = W * DPR, physH = H * DPR;
  const { ampX, ampY, halfW, halfH } = getAmps(physW, physH);
  const useLut = useXyLut();
  if (useLut) xyLut.rebuild(ampX, ampY, halfW, halfH);

  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let l = bufL[i], r = bufR[i];
    if (state.swapLR) { const t = l; l = r; r = t; }
    if (state.invertY) r = -r;
    if (useLut) {
      xs[i] = xyLut.xOf(l);
      ys[i] = xyLut.yOf(r);
    } else {
      if (l > 1.2) l = 1.2; else if (l < -1.2) l = -1.2;
      if (r > 1.2) r = 1.2; else if (r < -1.2) r = -1.2;
      xs[i] = halfW + l * ampX;
      ys[i] = halfH - r * ampY;
    }
  }

  const breakDist2 = (physW * 0.25) ** 2;
  const segs = new Float32Array(Math.max(0, n - 1) * 4);
  let segCount = 0;
  for (let i = 1; i < n; i++) {
    const x0 = xs[i - 1], y0 = ys[i - 1];
    const x1 = xs[i], y1 = ys[i];
    const dx = x1 - x0, dy = y1 - y0;
    if (dx * dx + dy * dy > breakDist2) continue;
    const o = segCount * 4;
    segs[o] = x0; segs[o + 1] = y0; segs[o + 2] = x1; segs[o + 3] = y1;
    segCount++;
  }
  const lines = segs.subarray(0, segCount * 4);

  const batches = [];
  if (glow) batches.push({ type: 'lines', data: lines, width: lineWidth * 2.5 * DPR, color: COLOR_GLOW });
  batches.push({ type: 'lines', data: lines, width: lineWidth * DPR, color: COLOR_MAIN });
  return batches;
}

/** X-Y 像素点阵（可选连线、孤立点淡出） */
export function buildXYPixel(bufL, bufR, xyLut, dotAtlas) {
  const { W, H, DPR, pixelSize, linkAlpha, isoStrength, pixelLink, isoFade } = state;
  const n = Math.min(bufL.length, 8192);
  const physW = W * DPR, physH = H * DPR;
  const { ampX, ampY, halfW, halfH } = getAmps(physW, physH);
  const useLut = useXyLut();
  if (useLut) xyLut.rebuild(ampX, ampY, halfW, halfH);

  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let l = bufL[i], r = bufR[i];
    if (state.swapLR) { const t = l; l = r; r = t; }
    if (state.invertY) r = -r;
    if (useLut) {
      xs[i] = xyLut.xOf(l);
      ys[i] = xyLut.yOf(r);
    } else {
      if (l > 1.2) l = 1.2; else if (l < -1.2) l = -1.2;
      if (r > 1.2) r = 1.2; else if (r < -1.2) r = -1.2;
      xs[i] = halfW + l * ampX;
      ys[i] = halfH - r * ampY;
    }
  }

  // 孤立点透明度
  const alphas = new Float32Array(n);
  if (isoFade) {
    const refDist = Math.max(physW, physH) * 0.12;
    const MIN = 0.08;
    for (let i = 0; i < n; i++) {
      let dMax = 0;
      if (i > 0) {
        const dx = xs[i] - xs[i - 1], dy = ys[i] - ys[i - 1];
        dMax = Math.sqrt(dx * dx + dy * dy);
      }
      if (i < n - 1) {
        const dx = xs[i] - xs[i + 1], dy = ys[i] - ys[i + 1];
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > dMax) dMax = d;
      }
      let t = dMax / refDist; if (t > 1) t = 1;
      let a = 1 - t * isoStrength;
      if (a < MIN) a = MIN;
      alphas[i] = a;
    }
  } else alphas.fill(1);

  const batches = [];
  const size = pixelSize * DPR;

  // 1. 连线层（按 alpha 分桶）
  if (pixelLink && linkAlpha > 0.02) {
    const BUCKETS = 8;
    const maxDist = physW * 0.12;
    const maxDist2 = maxDist * maxDist;
    const buks = Array.from({ length: BUCKETS }, () => []);

    for (let i = 1; i < n; i++) {
      const x0 = xs[i - 1], y0 = ys[i - 1];
      const x1 = xs[i], y1 = ys[i];
      const dx = x1 - x0, dy = y1 - y0;
      const d2 = dx * dx + dy * dy;
      if (d2 > maxDist2) continue;
      const d = Math.sqrt(d2);
      const t = d / maxDist;
      let a = (1 - t) * (1 - t) * linkAlpha;
      a *= Math.min(alphas[i - 1], alphas[i]);
      if (a < 0.02) continue;
      let b = Math.floor(a / linkAlpha * BUCKETS);
      if (b >= BUCKETS) b = BUCKETS - 1;
      if (b < 0) b = 0;
      buks[b].push(x0, y0, x1, y1);
    }

    const lw = Math.max(0.4, size * 0.55);
    for (let b = 0; b < BUCKETS; b++) {
      if (buks[b].length === 0) continue;
      const a = ((b + 0.5) / BUCKETS) * linkAlpha;
      batches.push({
        type: 'lines', data: new Float32Array(buks[b]), width: lw,
        color: [200 / 255, 255 / 255, 226 / 255, a],
      });
    }
  }

  // 2. 点层（去重 + 分桶）
  {
    const BUCKETS = 8;
    const BIG = 16384;
    const painted = new Map();

    for (let i = 0; i < n; i++) {
      const fx = xs[i], fy = ys[i];
      if (fx < -size || fx > physW + size || fy < -size || fy > physH + size) continue;
      const gx = Math.round(fx / size);
      const gy = Math.round(fy / size);
      const key = gy * BIG + gx;
      const a = alphas[i];
      const prev = painted.get(key);
      if (prev === undefined || a > prev) painted.set(key, a);
    }

    const buks = Array.from({ length: BUCKETS }, () => []);
    painted.forEach((a, key) => {
      const gx = key % BIG;
      const gy = (key / BIG) | 0;
      let b = Math.floor(a * BUCKETS);
      if (b >= BUCKETS) b = BUCKETS - 1;
      if (b < 0) b = 0;
      buks[b].push(gx * size, gy * size);
    });

    for (let b = 0; b < BUCKETS; b++) {
      if (buks[b].length === 0) continue;
      const a = (b + 0.5) / BUCKETS;
      batches.push({
        type: 'dots', data: new Float32Array(buks[b]), size,
        color: [200 / 255, 255 / 255, 226 / 255, a],
      });
    }
  }

  // 3. 扫描头（末尾 64 点，不透明白色）
  {
    const HEAD = Math.min(64, n);
    const pts = [];
    for (let i = n - HEAD; i < n; i++) {
      if (i < 0) continue;
      const fx = xs[i], fy = ys[i];
      if (fx < 0 || fx > physW || fy < 0 || fy > physH) continue;
      const gx = Math.round(fx / size);
      const gy = Math.round(fy / size);
      pts.push(gx * size, gy * size);
    }
    if (pts.length) {
      batches.push({ type: 'dots', data: new Float32Array(pts), size, color: COLOR_HEAD });
    }
  }

  return batches;
}