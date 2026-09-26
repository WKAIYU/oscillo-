// 音频引擎：加载、播放、分析器、采样率探测
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyserL = null;
    this.analyserR = null;
    this.gainNode = null;
    this.srcNode = null;
    this.bufL = null;
    this.bufR = null;

    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.volume = 1;

    this.objectUrl = null;
    this.deviceSampleRate = 0;
    this.fileSampleRate = 0;
    this.fileName = '';
    this.initialized = false;

    // 事件回调
    this.onStateChange = null;   // (playing) => void
    this.onFileChange = null;    // () => void
  }

  async init() {
    if (this.initialized) {
      if (this.ctx.state === 'suspended') try { await this.ctx.resume(); } catch(e) {}
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('浏览器不支持 Web Audio API');

    this.ctx = new AC();
    this.deviceSampleRate = this.ctx.sampleRate;

    this.srcNode   = this.ctx.createMediaElementSource(this.el);
    const sp       = this.ctx.createChannelSplitter(2);
    this.analyserL = this.ctx.createAnalyser();
    this.analyserR = this.ctx.createAnalyser();
    this.gainNode  = this.ctx.createGain();

    this.analyserL.fftSize = 4096;
    this.analyserR.fftSize = 4096;
    this.analyserL.smoothingTimeConstant = 0;
    this.analyserR.smoothingTimeConstant = 0;
    this.gainNode.gain.value = 0.8;

    this.srcNode.connect(sp);
    sp.connect(this.analyserL, 0);
    sp.connect(this.analyserR, 1);
    this.srcNode.connect(this.gainNode);
    this.gainNode.connect(this.ctx.destination);

    this.bufL = new Float32Array(this.analyserL.fftSize);
    this.bufR = new Float32Array(this.analyserR.fftSize);

    this.el.addEventListener('play',  () => this.onStateChange?.(true));
    this.el.addEventListener('pause', () => this.onStateChange?.(false));
    this.el.addEventListener('ended', () => this.onStateChange?.(false));

    this.initialized = true;
  }

  setVolume(v) { if (this.gainNode) this.gainNode.gain.value = v; }

  async loadFile(file) {
    await this.init();
    if (this.ctx.state === 'suspended') try { await this.ctx.resume(); } catch(e) {}

    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);

    this.el.pause();
    this.el.src = this.objectUrl;
    this.el.load();
    this.el.currentTime = 0;

    this.fileName = file.name || 'audio';
    this.fileSampleRate = 0;
    this.onFileChange?.();

    // 异步探测原始采样率
    this._probeSampleRate(file).then(sr => {
      if (sr) { this.fileSampleRate = sr; this.onFileChange?.(); }
    });
  }

  async _probeSampleRate(file) {
    try {
      const buf = await file.arrayBuffer();
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const probe = new OAC(1, 1, 44100);
      const audio = await probe.decodeAudioData(buf);
      return audio.sampleRate;
    } catch(e) { return null; }
  }

  // 返回状态：'no-source' | 'playing' | 'paused' | 'error'
  async toggle() {
    if (!this.el.src) return 'no-source';
    await this.init();
    if (this.ctx.state === 'suspended') try { await this.ctx.resume(); } catch(e) {}

    if (this.el.paused) {
      if (this.el.ended ||
          (isFinite(this.el.duration) && this.el.currentTime >= this.el.duration - 0.02)) {
        this.el.currentTime = 0;
      }
      try { await this.el.play(); return 'playing'; }
      catch(e) { console.warn('播放失败', e); return 'error'; }
    } else {
      this.el.pause();
      return 'paused';
    }
  }

  stop() {
    this.el.pause();
    this.el.currentTime = 0;
  }

  readAnalyser() {
    if (!this.analyserL) return;
    this.analyserL.getFloatTimeDomainData(this.bufL);
    this.analyserR.getFloatTimeDomainData(this.bufR);
  }

  get hasSource()  { return !!this.el.src; }
  get isPlaying()  { return !this.el.paused && !this.el.ended; }
  get currentTime(){ return this.el.currentTime; }
  get duration()   { return this.el.duration; }
  get sampleRate() { return this.ctx?.sampleRate || 0; }
  get buffers()    { return { bufL: this.bufL, bufR: this.bufR }; }
}