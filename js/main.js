// 入口：初始化、主循环、UI 绑定

import { state } from './state.js';
import { clamp, fmtTime, fmtSampleRate, fmtMs } from './utils.js';
import { AudioEngine } from './audio.js';
import { XyLut, YtLut, DotAtlas } from './lut.js';
import { buildYT, buildXYVector, buildXYPixel } from './geometry.js';
import { PerfMonitor } from './perf.js';
import { Canvas2DRenderer } from './renderers/canvas2d.js';
import { WebGPURenderer } from './renderers/webgpu.js';

/* ================= DOM ================= */
const $ = id => document.getElementById(id);
const dom = {
  screen: $('screen'), grid: $('grid'), wave2d: $('wave2d'), wavegpu: $('wavegpu'),
  scanlines: $('scanlines'), vignette: $('vignette'), phosphor: $('phosphorGlow'),

  fileBtn: $('fileBtn'), fileInput: $('fileInput'), playBtn: $('playBtn'), stopBtn: $('stopBtn'),
  levelBar: $('levelBar'),

  modeYT: $('modeYT'), modeXY: $('modeXY'),
  glowMode: $('glowMode'), equalAspect: $('equalAspect'),
  swapLR: $('swapLR'), invertY: $('invertY'),
  switchPixel: $('switchPixel'), switchPixelLink: $('switchPixelLink'), switchIsoFade: $('switchIsoFade'),
  pixelMode: $('pixelMode'), pixelLink: $('pixelLink'), isoFade: $('isoFade'),

  tb: $('tb'), tbVal: $('tbVal'),
  gain: $('gain'), gVal: $('gVal'),
  trig: $('trig'), tVal: $('tVal'),
  vol: $('vol'), vVal: $('vVal'),
  lineW: $('lineW'), lVal: $('lVal'), lineLabel: $('lineLabel'),
  linkW: $('linkW'), lkVal: $('lkVal'),
  isoW: $('isoW'), isoVal: $('isoVal'),
  fps: $('fps'), fpsVal: $('fpsVal'),

  paramTb: $('paramTb'), paramTrig: $('paramTrig'), paramLink: $('paramLink'), paramIso: $('paramIso'),

  fileName: $('fileName'), srReadout: $('srReadout'), renderMode: $('renderMode'),
  fpsReadout: $('fpsReadout'), timeReadout: $('timeReadout'),
  statusLine: $('statusLine'), dropHint: $('dropHint'),

  // 设置
  settingsBtn: $('settingsBtn'), settingsBackdrop: $('settingsBackdrop'),
  settingsModal: $('settingsModal'), settingsClose: $('settingsClose'),
  gpuChk: $('gpuChk'), gpuChip: $('gpuChip'), gpuStatus: $('gpuStatus'),
  scanlineChk: $('scanlineChk'), vignetteChk: $('vignetteChk'), phosphorChk: $('phosphorChk'),
  presetClassic: $('presetClassic'), presetRetro: $('presetRetro'),

  // 性能面板
  perfPanel: $('perfPanel'), perfReadout: $('perfReadout'),
  perfClose: $('perfClose'), perfReset: $('perfReset'), perfCopy: $('perfCopy'),
  perfFps: $('perfFps'), perfMs: $('perfMs'), perfAvg: $('perfAvg'),
  perfMin: $('perfMin'), perfMax: $('perfMax'), perfLow: $('perfLow'), perfCount: $('perfCount'),
};

/* ================= 模块实例 ================= */
const audio = new AudioEngine();
const xyLut = new XyLut();
const ytLut = new YtLut();
const dotAtlas = new DotAtlas();
const perf = new PerfMonitor({
  readout: dom.perfReadout,
  panel: dom.perfPanel,
  closeBtn: dom.perfClose,
  resetBtn: dom.perfReset,
  copyBtn: dom.perfCopy,
  fpsEl: dom.perfFps, msEl: dom.perfMs, avgEl: dom.perfAvg,
  minEl: dom.perfMin, maxEl: dom.perfMax, lowEl: dom.perfLow, countEl: dom.perfCount,
});
perf.onCopy = msg => dom.statusLine.textContent = msg;
perf.infoProvider = () => ({
  rendererName: renderer?.name || '--',
  prerenderMode: state.prerenderMode,
  waveMode: state.mode + (state.mode === 'XY' ? (state.pixelMode ? ' 像素' : ' 矢量') : ''),
  targetFps: state.targetFPS === 0 ? '不限' : state.targetFPS + ' fps',
});

let renderer = null;   // 当前渲染器
let ctxG = dom.grid.getContext('2d');

/* ================= 电平表 / 计时状态 ================= */
let meterLevel = 0;
let lastTimeText = '';
let fpsCounter = 0;
let fpsLastUpdate = performance.now();
let lastFrameTime = 0;

/* ================= 画布尺寸 ================= */
function resize() {
  const rect = dom.screen.getBoundingClientRect();
  state.DPR = Math.min(window.devicePixelRatio || 1, 2);
  state.W = Math.max(1, rect.width);
  state.H = Math.max(1, rect.height);

  // 网格 canvas
  const physW = Math.round(state.W * state.DPR);
  const physH = Math.round(state.H * state.DPR);
  dom.grid.width = physW;
  dom.grid.height = physH;
  ctxG.setTransform(state.DPR, 0, 0, state.DPR, 0, 0);

  // 渲染器 canvas
  if (renderer) renderer.resize(state.W, state.H, state.DPR);

  drawGrid(state.mode === 'XY');
  rebuildLuts();
}

function rebuildLuts() {
  xyLut.rebuild(1, 1, state.W * state.DPR / 2, state.H * state.DPR / 2);
  ytLut.invalidate();
  dotAtlas.rebuild(state.pixelSize, state.DPR);
}

/* ================= 网格 ================= */
const DIV_X = 10, DIV_Y = 8;
function drawGrid(xyMode) {
  const c = ctxG;
  const { W, H } = state;
  c.clearRect(0, 0, W, H);

  const bg = c.createRadialGradient(W * .5, H * .5, 0, W * .5, H * .5, Math.max(W, H) * .75);
  bg.addColorStop(0, '#08170f');
  bg.addColorStop(1, '#020705');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);

  const dx = W / DIV_X, dy = H / DIV_Y;
  c.lineWidth = 1;
  c.strokeStyle = 'rgba(0,255,150,0.075)';
  c.beginPath();
  for (let i = 1; i < DIV_X; i++) { c.moveTo(i * dx, 0); c.lineTo(i * dx, H); }
  for (let j = 1; j < DIV_Y; j++) { c.moveTo(0, j * dy); c.lineTo(W, j * dy); }
  c.stroke();

  if (xyMode) {
    c.strokeStyle = 'rgba(0,255,150,0.18)';
    c.beginPath();
    c.moveTo(W / 2, 0); c.lineTo(W / 2, H);
    c.moveTo(0, H / 2); c.lineTo(W, H / 2);
    c.stroke();
    c.strokeStyle = 'rgba(0,255,150,0.12)';
    c.setLineDash([4, 4]);
    if (state.equalAspect) {
      const side = Math.min(W, H) * 0.92;
      c.strokeRect((W - side) / 2, (H - side) / 2, side, side);
    } else {
      c.strokeRect(W * 0.05, H * 0.05, W * 0.90, H * 0.90);
    }
    c.setLineDash([]);
    c.strokeStyle = 'rgba(0,255,150,0.05)';
    c.beginPath();
    c.moveTo(0, 0); c.lineTo(W, H);
    c.moveTo(W, 0); c.lineTo(0, H);
    c.stroke();
  } else {
    c.strokeStyle = 'rgba(0,255,150,0.20)';
    c.beginPath();
    c.moveTo(W / 2, 0); c.lineTo(W / 2, H);
    c.moveTo(0, H / 2); c.lineTo(W, H / 2);
    c.stroke();
    c.strokeStyle = 'rgba(0,255,150,0.30)';
    c.beginPath();
    for (let i = 0; i <= DIV_X; i++) { const x = i * dx; c.moveTo(x, H / 2 - 4); c.lineTo(x, H / 2 + 4); }
    for (let j = 0; j <= DIV_Y; j++) { const y = j * dy; c.moveTo(W / 2 - 4, y); c.lineTo(W / 2 + 4, y); }
    c.stroke();
  }
  c.strokeStyle = 'rgba(0,255,150,0.14)';
  c.strokeRect(0.5, 0.5, W - 1, H - 1);
}

/* ================= 渲染器管理 ================= */
async function createRenderer(useGPU) {
  if (renderer) { renderer.destroy(); renderer = null; }

  if (useGPU) {
    const r = new WebGPURenderer(dom.wavegpu);
    await r.init();
    dom.wave2d.style.display = 'none';
    dom.wavegpu.classList.add('show');
    renderer = r;
    state.useGPU = true;
  } else {
    const r = new Canvas2DRenderer(dom.wave2d);
    await r.init();
    dom.wavegpu.classList.remove('show');
    dom.wave2d.style.display = 'block';
    renderer = r;
    state.useGPU = false;
  }
  renderer.resize(state.W, state.H, state.DPR);
  updateRenderModeReadout();
  perf.reset();
}

function updateRenderModeReadout() {
  let txt;
  if (state.useGPU) txt = 'R: GPU';
  else if (state.prerenderMode === 'off') txt = 'R: 实时';
  else if (state.prerenderMode === 'lut') txt = 'R: LUT';
  else txt = 'R: 完整';
  dom.renderMode.textContent = txt;
}

/* ================= 主循环 ================= */
function render() {
  requestAnimationFrame(render);
  const now = performance.now();

  // FPS 节流
  if (state.targetFPS > 0) {
    const interval = 1000 / state.targetFPS;
    if (now - lastFrameTime < interval - 1) return;
    lastFrameTime = now;
  } else {
    lastFrameTime = now;
  }

  // FPS 统计 + 性能面板刷新
  fpsCounter++;
  if (now - fpsLastUpdate >= 500) {
    const actualFps = fpsCounter * 1000 / (now - fpsLastUpdate);
    dom.fpsReadout.textContent = actualFps.toFixed(0) + ' fps';
    fpsCounter = 0;
    fpsLastUpdate = now;
    perf.tick(perf.currentMs, actualFps);
  }

  if (!audio.isPlaying || !renderer) return;

  audio.readAnalyser();
  const { bufL, bufR } = audio.buffers;

  // 生成批次（核心逻辑）
  let batches;
  if (state.mode === 'XY') {
    if (state.pixelMode) batches = buildXYPixel(bufL, bufR, xyLut, dotAtlas);
    else                 batches = buildXYVector(bufL, bufR, xyLut);
  } else {
    batches = buildYT(bufL, audio.sampleRate, ytLut);
  }

  // 绘制并计时
  const t0 = performance.now();
  renderer.render(batches);
  const drawMs = performance.now() - t0;
  perf.currentMs = drawMs;

  // 电平表
  let peak = 0;
  for (let i = 0; i < bufL.length; i += 8) {
    const a = Math.abs(bufL[i]); if (a > peak) peak = a;
    const b = Math.abs(bufR[i]); if (b > peak) peak = b;
  }
  meterLevel = Math.max(peak, meterLevel * 0.90);
  dom.levelBar.style.width = Math.min(100, meterLevel * 100).toFixed(1) + '%';

  // 时间读数
  const txt = fmtTime(audio.currentTime) + ' / ' + fmtTime(audio.duration);
  if (txt !== lastTimeText) { dom.timeReadout.textContent = txt; lastTimeText = txt; }
}

/* ================= UI 绑定 ================= */
function bindUI() {
  // 传输
  dom.fileBtn.addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) loadFile(f);
    dom.fileInput.value = '';
  });
  dom.playBtn.addEventListener('click', togglePlay);
  dom.stopBtn.addEventListener('click', () => {
    audio.stop();
    perf.reset();
    updatePlayBtn();
  });

  // 模式
  dom.modeYT.addEventListener('click', () => setMode('YT'));
  dom.modeXY.addEventListener('click', () => setMode('XY'));

  // 显示开关
  const toggleState = (el, key, after) => {
    el.addEventListener('change', () => {
      state[key] = el.checked;
      after?.();
    });
  };
  toggleState(dom.glowMode, 'glow');
  toggleState(dom.equalAspect, 'equalAspect', () => {
    if (state.mode === 'XY') { drawGrid(true); rebuildLuts(); }
  });
  toggleState(dom.swapLR, 'swapLR');
  toggleState(dom.invertY, 'invertY');
  toggleState(dom.pixelMode, 'pixelMode', () => {
    refreshLineControl();
    updatePixelUI();
    if (state.mode === 'XY') statusLine(pixelStatusText());
  });
  toggleState(dom.pixelLink, 'pixelLink', updatePixelUI);
  toggleState(dom.isoFade, 'isoFade', updatePixelUI);

  // 参数滑块
  dom.tb.addEventListener('input', () => {
    state.timebaseMs = sliderToTimebase(+dom.tb.value);
    dom.tbVal.textContent = fmtMs(state.timebaseMs);
    ytLut.invalidate();
  });
  dom.gain.addEventListener('input', () => {
    state.vGain = 0.2 * Math.pow(25, +dom.gain.value / 100);
    dom.gVal.textContent = state.vGain.toFixed(2) + '×';
    rebuildLuts();
  });
  dom.trig.addEventListener('input', () => {
    state.trigLevel = +dom.trig.value / 100;
    dom.tVal.textContent = state.trigLevel.toFixed(2);
  });
  dom.vol.addEventListener('input', () => {
    state.volume = +dom.vol.value / 100;
    audio.setVolume(state.volume);
    dom.vVal.textContent = Math.round(state.volume * 100) + '%';
  });
  dom.lineW.addEventListener('input', refreshLineControl);
  dom.linkW.addEventListener('input', refreshLinkControl);
  dom.isoW.addEventListener('input', refreshIsoControl);
  dom.fps.addEventListener('input', () => {
    state.targetFPS = +dom.fps.value;
    dom.fpsVal.textContent = state.targetFPS === 0 ? '不限' : state.targetFPS + ' fps';
    lastFrameTime = 0;
    perf.reset();
  });

  // 设置弹窗
  dom.settingsBtn.addEventListener('click', openSettings);
  dom.settingsClose.addEventListener('click', closeSettings);
  dom.settingsBackdrop.addEventListener('click', closeSettings);

  // 性能 radio
  document.querySelectorAll('input[name=perf]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      state.prerenderMode = radio.value;
      rebuildLuts();
      updateRenderModeReadout();
      perf.reset();
    });
  });

  // GPU 开关
  dom.gpuChk.addEventListener('change', async () => {
    if (dom.gpuChk.checked) {
      try {
        await createRenderer(true);
        dom.gpuStatus.className = 'gpu-status ok';
        dom.gpuStatus.textContent = 'WebGPU 已启用';
        statusLine('WebGPU 已启用');
      } catch (e) {
        dom.gpuChk.checked = false;
        dom.gpuStatus.className = 'gpu-status err';
        dom.gpuStatus.textContent = '初始化失败：' + (e.message || e);
      }
    } else {
      await createRenderer(false);
      dom.gpuStatus.className = 'gpu-status';
      dom.gpuStatus.textContent = 'WebGPU 已关闭';
      statusLine('使用 Canvas 2D');
    }
  });

  // 复古
  const applyOverlays = () => {
    state.scanline = dom.scanlineChk.checked;
    state.vignette = dom.vignetteChk.checked;
    state.phosphor = dom.phosphorChk.checked;
    dom.scanlines.classList.toggle('show', state.scanline);
    dom.vignette.classList.toggle('show', state.vignette);
    dom.phosphor.classList.toggle('show', state.phosphor);
  };
  dom.scanlineChk.addEventListener('change', applyOverlays);
  dom.vignetteChk.addEventListener('change', applyOverlays);
  dom.phosphorChk.addEventListener('change', applyOverlays);
  dom.presetClassic.addEventListener('click', () => {
    dom.scanlineChk.checked = false;
    dom.vignetteChk.checked = false;
    dom.phosphorChk.checked = false;
    applyOverlays();
  });
  dom.presetRetro.addEventListener('click', () => {
    dom.scanlineChk.checked = true;
    dom.vignetteChk.checked = true;
    dom.phosphorChk.checked = true;
    applyOverlays();
  });

  // 键盘
  window.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) || '';
    if (settingsIsOpen()) {
      if (e.code === 'Escape') { e.preventDefault(); closeSettings(); }
      return;
    }
    if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA') return;

    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.code === 'KeyM') setMode(state.mode === 'XY' ? 'YT' : 'XY');
    if (e.code === 'KeyS') { e.preventDefault(); openSettings(); }
    if (e.code === 'KeyH') perf.toggle();
    if (e.code === 'KeyG') {
      dom.glowMode.checked = !dom.glowMode.checked;
      dom.glowMode.dispatchEvent(new Event('change'));
    }
  });

  // 拖拽
  ['dragenter', 'dragover'].forEach(evt => {
    window.addEventListener(evt, e => { e.preventDefault(); dom.screen.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(evt => {
    window.addEventListener(evt, e => {
      e.preventDefault();
      if (evt === 'dragleave' && e.relatedTarget) return;
      dom.screen.classList.remove('dragover');
    });
  });
  window.addEventListener('drop', e => {
    const f = e.dataTransfer?.files?.[0];
    if (f) loadFile(f);
  });
}

/* ================= 辅助 ================= */
function statusLine(msg) { dom.statusLine.textContent = msg; }

function pixelStatusText() {
  return state.pixelMode
    ? 'X-Y 像素模式　·　数字示波器颗粒感'
    : 'X-Y 矢量模式　·　左声道→X，右声道→Y';
}

function sliderToTimebase(v) { return 0.2 * Math.pow(250, v / 100); }

function refreshLineControl() {
  const v = +dom.lineW.value;
  if (state.mode === 'XY' && state.pixelMode) {
    const step = Math.min(10, Math.floor(v / 10));
    state.pixelSize = 0.5 + step * 0.5;
    dom.lineLabel.textContent = '像素 PIXEL';
    dom.lVal.textContent = state.pixelSize.toFixed(1) + 'px';
    dotAtlas.rebuild(state.pixelSize, state.DPR);
  } else {
    state.lineWidth = 0.5 + (v / 100) * 3.5;
    dom.lineLabel.textContent = '线条 LINE';
    dom.lVal.textContent = state.lineWidth.toFixed(1);
  }
}

function refreshLinkControl() {
  state.linkAlpha = 0.05 + (+dom.linkW.value / 100) * 0.95;
  const a = state.linkAlpha;
  const label = a < 0.10 ? '极弱' : a < 0.28 ? '弱' : a < 0.55 ? '中' : a < 0.80 ? '强' : '极强';
  dom.lkVal.textContent = label;
}

function refreshIsoControl() {
  state.isoStrength = +dom.isoW.value / 100;
  const s = state.isoStrength;
  dom.isoVal.textContent = s < 0.15 ? '弱' : s < 0.40 ? '中' : s < 0.70 ? '强' : '极强';
}

function updatePixelUI() {
  const xyPixel = state.mode === 'XY' && state.pixelMode;
  dom.switchPixel.classList.toggle('disabled', state.mode !== 'XY');
  dom.switchPixelLink.classList.toggle('disabled', !xyPixel);
  dom.switchIsoFade.classList.toggle('disabled', !xyPixel);
  dom.paramTb.classList.toggle('disabled', state.mode === 'XY');
  dom.paramTrig.classList.toggle('disabled', state.mode === 'XY');
  dom.paramLink.classList.toggle('disabled', !(xyPixel && state.pixelLink));
  dom.paramIso.classList.toggle('disabled', !(xyPixel && state.isoFade));
  updateRenderModeReadout();
}

function setMode(m) {
  state.mode = m;
  if (m === 'XY') {
    dom.modeXY.classList.add('mode-active');
    dom.modeYT.classList.remove('mode-active');
    refreshLineControl();
    updatePixelUI();
    rebuildLuts();
    statusLine(pixelStatusText());
    drawGrid(true);
  } else {
    dom.modeYT.classList.add('mode-active');
    dom.modeXY.classList.remove('mode-active');
    refreshLineControl();
    updatePixelUI();
    statusLine('Y-T 时域模式　·　边缘触发同步');
    drawGrid(false);
  }
  perf.reset();
}

function updatePlayBtn() {
  const playing = audio.isPlaying;
  dom.playBtn.textContent = playing ? '⏸ 暂停' : '▶ 播放';
  dom.playBtn.classList.toggle('playing', playing);
}

async function togglePlay() {
  if (!audio.hasSource) { dom.fileInput.click(); return; }
  const result = await audio.toggle();
  if (result === 'error') statusLine('播放失败');
  updatePlayBtn();
}

async function loadFile(file) {
  try {
    await audio.loadFile(file);
    dom.fileName.textContent = audio.fileName;
    dom.dropHint.classList.add('hide');
    perf.reset();
    updatePlayBtn();
    updateSampleRate();
  } catch (e) {
    statusLine('加载失败：' + (e.message || e));
  }
}

function updateSampleRate() {
  const dev = audio.deviceSampleRate ? fmtSampleRate(audio.deviceSampleRate) : '--';
  if (!audio.fileSampleRate) {
    dom.srReadout.textContent = 'SR ' + dev;
    dom.srReadout.classList.remove('warn');
    return;
  }
  const file = fmtSampleRate(audio.fileSampleRate);
  dom.srReadout.textContent = 'SR ' + dev + ' / ' + file;
  if (audio.deviceSampleRate && audio.fileSampleRate > audio.deviceSampleRate) {
    dom.srReadout.classList.add('warn');
  } else {
    dom.srReadout.classList.remove('warn');
  }
}

/* ================= 设置弹窗 ================= */
function openSettings() {
  dom.settingsBackdrop.classList.add('show');
  dom.settingsModal.classList.add('show');
}
function closeSettings() {
  dom.settingsBackdrop.classList.remove('show');
  dom.settingsModal.classList.remove('show');
}
function settingsIsOpen() { return dom.settingsModal.classList.contains('show'); }

/* ================= 启动 ================= */
async function init() {
  // 初始 state 与 DOM 同步
  state.timebaseMs = sliderToTimebase(+dom.tb.value);
  state.vGain = 0.2 * Math.pow(25, +dom.gain.value / 100);
  state.trigLevel = +dom.trig.value / 100;
  state.volume = +dom.vol.value / 100;
  state.targetFPS = +dom.fps.value;

  dom.tbVal.textContent = fmtMs(state.timebaseMs);
  dom.gVal.textContent = state.vGain.toFixed(2) + '×';
  dom.tVal.textContent = state.trigLevel.toFixed(2);
  dom.vVal.textContent = Math.round(state.volume * 100) + '%';
  dom.fpsVal.textContent = state.targetFPS + ' fps';
  refreshLineControl();
  refreshLinkControl();
  refreshIsoControl();

  // 音频事件
  audio.onStateChange = () => updatePlayBtn();
  audio.onFileChange = () => {
    dom.fileName.textContent = audio.fileName;
    updateSampleRate();
  };

  // 渲染器
  await createRenderer(false);   // 默认 Canvas 2D

  resize();
  updatePixelUI();

  // WebGPU 可用性检测
  if (!WebGPURenderer.isSupported()) {
    dom.gpuChip.classList.add('disabled');
    dom.gpuStatus.className = 'gpu-status err';
    dom.gpuStatus.textContent = '此浏览器不支持 WebGPU（需要 Chrome 113+ / Edge 113+）';
  } else {
    dom.gpuStatus.textContent = '可用 · 点击开关启用';
  }

  bindUI();
  updatePlayBtn();
  requestAnimationFrame(render);

  window.addEventListener('resize', () => {
    clearTimeout(window.__rz);
    window.__rz = setTimeout(resize, 120);
  });
}

init();