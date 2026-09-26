// 集中状态：所有模块共享
export const state = {
  // 尺寸
  W: 0, H: 0, DPR: 1,

  // 模式
  mode: 'YT',              // 'YT' | 'XY'
  pixelMode: false,
  useGPU: false,
  prerenderMode: 'full',   // 'off' | 'lut' | 'full'

  // 显示
  glow: true,
  equalAspect: true,
  swapLR: false,
  invertY: false,
  pixelLink: true,
  isoFade: true,

  // 复古
  scanline: false,
  vignette: false,
  phosphor: false,

  // 参数
  timebaseMs: 5,
  vGain: 1,
  trigLevel: 0,
  lineWidth: 1.5,
  pixelSize: 2.0,
  linkAlpha: 0.55,
  isoStrength: 0.60,
  volume: 0.8,
  targetFPS: 60,
};

// 由 prerenderMode 派生的快捷判断
export const useXyLut    = () => state.prerenderMode !== 'off';
export const useYtLut    = () => state.prerenderMode !== 'off';
export const useDotAtlas = () => state.prerenderMode === 'full';