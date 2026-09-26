import { colorStr } from '../utils.js';

export class Canvas2DRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.name = 'Canvas 2D';
    this.physW = 0;
    this.physH = 0;
  }

  async init() {}

  resize(cssW, cssH, dpr) {
    this.physW = Math.round(cssW * dpr);
    this.physH = Math.round(cssH * dpr);
    this.canvas.width = this.physW;
    this.canvas.height = this.physH;
    // 不用 setTransform，直接用物理像素坐标
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  render(batches) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.physW, this.physH);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (const b of batches) {
      if (b.type === 'lines') this._drawLines(b);
      else if (b.type === 'dots') this._drawDots(b);
    }
  }

  _drawLines(b) {
    const ctx = this.ctx;
    const data = b.data;
    const n = data.length / 4;
    if (n === 0) return;

    ctx.strokeStyle = colorStr(b.color);
    ctx.lineWidth = b.width;

    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      ctx.moveTo(data[o], data[o + 1]);
      ctx.lineTo(data[o + 2], data[o + 3]);
    }
    ctx.stroke();
  }

  _drawDots(b) {
    const ctx = this.ctx;
    const data = b.data;
    const n = data.length / 2;
    if (n === 0) return;

    ctx.fillStyle = colorStr(b.color);
    const size = b.size;
    for (let i = 0; i < n; i++) {
      ctx.fillRect(data[i * 2], data[i * 2 + 1], size, size);
    }
  }

  destroy() {}
}