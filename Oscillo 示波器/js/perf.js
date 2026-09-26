export class PerfMonitor {
  constructor(dom) {
    this.dom = dom;
    this.samples = [];
    this.WINDOW = 600;
    this.currentMs = 0;
    this.open = false;

    dom.closeBtn.addEventListener('click', () => this.hide());
    dom.resetBtn.addEventListener('click', () => this.reset());
    dom.copyBtn.addEventListener('click', () => this._copy());
    this.onCopy = null;
    this.infoProvider = null;
  }

  tick(drawMs, actualFps) {
    this.currentMs = drawMs;
    this.samples.push(drawMs);
    if (this.samples.length > this.WINDOW) this.samples.shift();

    this.dom.readout.textContent = 'P: ' + drawMs.toFixed(2) + ' ms';

    if (!this.open || this.samples.length === 0) return;
    const n = this.samples.length;

    let sum = 0, mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = this.samples[i];
      sum += v;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const avg = sum / n;

    const sorted = this.samples.slice().sort((a, b) => b - a);
    const lowCount = Math.max(1, Math.ceil(n * 0.01));
    let lowSum = 0;
    for (let i = 0; i < lowCount; i++) lowSum += sorted[i];
    const low1 = lowSum / lowCount;

    this.dom.fpsEl.textContent = actualFps.toFixed(0);
    this.dom.msEl.textContent = drawMs.toFixed(2) + ' ms';
    this.dom.avgEl.textContent = avg.toFixed(2) + ' ms';
    this.dom.minEl.textContent = mn.toFixed(2) + ' ms';
    this.dom.maxEl.textContent = mx.toFixed(2) + ' ms';
    this.dom.lowEl.textContent = low1.toFixed(2) + ' ms';
    this.dom.countEl.textContent = n + ' 帧';
  }

  reset() {
    this.samples.length = 0;
    this.currentMs = 0;
    this.dom.readout.textContent = 'P: -- ms';
    this.dom.fpsEl.textContent = '--';
    this.dom.msEl.textContent = '--';
    this.dom.avgEl.textContent = '--';
    this.dom.minEl.textContent = '--';
    this.dom.maxEl.textContent = '--';
    this.dom.lowEl.textContent = '--';
    this.dom.countEl.textContent = '0';
  }

  toggle() { this.open ? this.hide() : this.show(); }
  show() { this.open = true; this.dom.panel.classList.add('show'); }
  hide() { this.open = false; this.dom.panel.classList.remove('show'); }

  _copy() {
    const info = this.infoProvider?.() || {};
    const txt = [
      '渲染模式: ' + (info.rendererName || '--'),
      '性能模式: ' + (info.prerenderMode || '--'),
      '波形模式: ' + (info.waveMode || '--'),
      '目标帧率: ' + (info.targetFps ?? '--'),
      '当前绘制: ' + this.currentMs.toFixed(2) + ' ms',
      '平均: ' + this.dom.avgEl.textContent,
      '最小: ' + this.dom.minEl.textContent,
      '最大: ' + this.dom.maxEl.textContent,
      '1% Low: ' + this.dom.lowEl.textContent,
      '采样: ' + this.dom.countEl.textContent,
    ].join('\n');

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(txt).then(
        () => this.onCopy?.('性能数据已复制'),
        () => this.onCopy?.('复制失败')
      );
    } else {
      this.onCopy?.('当前环境不支持剪贴板');
    }
  }
}