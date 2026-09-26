// 三种预计算资源：XY 坐标查表、YT 采样索引、像素图集

export class XyLut {
  constructor(bins = 2048, min = -1.25, max = 1.25) {
    this.bins = bins;
    this.min = min;
    this.range = max - min;
    this.invScale = (bins - 1) / this.range;
    this.xs = new Float32Array(bins);
    this.ys = new Float32Array(bins);
  }

  rebuild(ampX, ampY, halfW, halfH) {
    for (let i = 0; i < this.bins; i++) {
      const v = this.min + (i / (this.bins - 1)) * this.range;
      this.xs[i] = halfW + v * ampX;
      this.ys[i] = halfH - v * ampY;
    }
  }

  xOf(v) {
    let i = ((v - this.min) * this.invScale) | 0;
    if (i < 0) i = 0; else if (i >= this.bins) i = this.bins - 1;
    return this.xs[i];
  }

  yOf(v) {
    let i = ((v - this.min) * this.invScale) | 0;
    if (i < 0) i = 0; else if (i >= this.bins) i = this.bins - 1;
    return this.ys[i];
  }
}

export class YtLut {
  constructor() { this.invalidate(); }
  invalidate() { this.pts = 0; this.win = 0; this.i0 = null; this.i1 = null; this.f = null; }

  rebuild(pts, win) {
    if (this.pts === pts && this.win === win && this.i0) return;
    this.i0 = new Int32Array(pts);
    this.i1 = new Int32Array(pts);
    this.f  = new Float32Array(pts);
    for (let i = 0; i < pts; i++) {
      const t = (i / (pts - 1)) * (win - 1);
      const i0 = t | 0;
      const i1 = i0 + 1 < win ? i0 + 1 : i0;
      this.i0[i] = i0;
      this.i1[i] = i1;
      this.f[i]  = t - i0;
    }
    this.pts = pts;
    this.win = win;
  }
}

export class DotAtlas {
  constructor() { this.buckets = []; this.physSize = 0; }

  rebuild(pixelSize, dpr) {
    const BUCKETS = 8;
    const physSize = Math.max(1, Math.round(pixelSize * dpr));
    if (this.physSize === physSize && this.buckets.length) return;

    this.buckets = [];
    this.physSize = physSize;
    for (let b = 0; b < BUCKETS; b++) {
      const c = document.createElement('canvas');
      c.width = c.height = physSize;
      const cx = c.getContext('2d');
      cx.fillStyle = `rgba(200,255,226,${((b + 0.5) / BUCKETS).toFixed(3)})`;
      cx.fillRect(0, 0, physSize, physSize);
      this.buckets.push(c);
    }
  }

  get(b) { return this.buckets[b]; }
}