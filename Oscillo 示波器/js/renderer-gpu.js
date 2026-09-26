/**
 * WebGPU 渲染器
 * - alphaMode = premultiplied（透明，露出下层网格）
 * - 加色混合（src + dst），模拟荧光叠加
 * - uniform 结构 16 字节，符合 WGSL 对齐
 */
(function (global) {
  'use strict';

  const USE_EXTERNAL_WGSL = false;

  const LINE_WGSL_INLINE = `
struct Uniforms {
  resolution : vec2<f32>,
  lineWidth  : f32,
  _pad0      : f32,
};
struct Line {
  p0    : vec2<f32>,
  p1    : vec2<f32>,
  color : vec4<f32>,
};
@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var<storage, read> lines : array<Line>;
struct VSIn {
  @builtin(vertex_index)   vi : u32,
  @builtin(instance_index) ii : u32,
};
struct VSOut {
  @builtin(position) pos   : vec4<f32>,
  @location(0)       color : vec4<f32>,
};
@vertex
fn vs_main(in : VSIn) -> VSOut {
  let line = lines[in.ii];
  let a = line.p0;
  let b = line.p1;
  var dir = b - a;
  let len = length(dir);
  if (len < 0.0001) { dir = vec2<f32>(1.0, 0.0); }
  else { dir = dir / len; }
  let nrm = vec2<f32>(-dir.y, dir.x);
  let halfW = max(u.lineWidth, 0.5) * 0.5;
  var base = a;
  if (in.vi >= 2u) { base = b; }
  var sign = -1.0;
  if (in.vi == 1u || in.vi == 3u) { sign = 1.0; }
  let world = base + nrm * halfW * sign;
  let ndc = (world / u.resolution) * 2.0 - vec2<f32>(1.0, 1.0);
  var out : VSOut;
  out.pos   = vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0);
  out.color = line.color;
  return out;
}
@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  let a = in.color.a;
  return vec4<f32>(in.color.rgb * a, a);
}
`;

  const DOT_WGSL_INLINE = `
struct Uniforms {
  resolution : vec2<f32>,
  lineWidth  : f32,
  _pad0      : f32,
};
struct Dot {
  pos   : vec2<f32>,
  size  : f32,
  _pad  : f32,
  color : vec4<f32>,
};
@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var<storage, read> dots : array<Dot>;
struct VSIn {
  @builtin(vertex_index)   vi : u32,
  @builtin(instance_index) ii : u32,
};
struct VSOut {
  @builtin(position) pos   : vec4<f32>,
  @location(0)       color : vec4<f32>,
};
@vertex
fn vs_main(in : VSIn) -> VSOut {
  let dot = dots[in.ii];
  let halfSize = max(dot.size, 1.0) * 0.5;
  var sx = -1.0;
  var sy = -1.0;
  if (in.vi == 1u || in.vi == 3u) { sx = 1.0; }
  if (in.vi == 2u || in.vi == 3u) { sy = 1.0; }
  let world = dot.pos + vec2<f32>(sx, sy) * halfSize;
  let ndc = (world / u.resolution) * 2.0 - vec2<f32>(1.0, 1.0);
  var out : VSOut;
  out.pos   = vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0);
  out.color = dot.color;
  return out;
}
@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  let a = in.color.a;
  return vec4<f32>(in.color.rgb * a, a);
}
`;

  let LINE_WGSL_CODE = null;
  let DOT_WGSL_CODE = null;

  async function loadShaders() {
    if (LINE_WGSL_CODE) return;
    if (USE_EXTERNAL_WGSL) {
      const [l, d] = await Promise.all([
        fetch('shaders/line.wgsl'),
        fetch('shaders/dot.wgsl'),
      ]);
      if (!l.ok || !d.ok) throw new Error('加载 .wgsl 失败，需通过 HTTP 服务器访问');
      LINE_WGSL_CODE = await l.text();
      DOT_WGSL_CODE = await d.text();
    } else {
      LINE_WGSL_CODE = LINE_WGSL_INLINE;
      DOT_WGSL_CODE = DOT_WGSL_INLINE;
    }
  }

  class RendererGPU {
    constructor() {
      this.device = null;
      this.context = null;
      this.format = null;
      this.canvas = null;
      this.linePipeline = null;
      this.dotPipeline = null;
      this.uniformBuffer = null;
      this.lineBuffer = null;
      this.dotBuffer = null;
      this.lineBindGroup = null;
      this.dotBindGroup = null;
      this.maxLines = 0;
      this.maxDots = 0;
      this.width = 1;
      this.height = 1;
    }

    static isSupported() {
      return typeof navigator !== 'undefined' && !!navigator.gpu;
    }

    async init(canvas) {
      if (!RendererGPU.isSupported()) throw new Error('浏览器不支持 WebGPU');

      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error('无法获取 GPU adapter');

      this.device = await adapter.requestDevice();
      this.canvas = canvas;
      this.context = canvas.getContext('webgpu');
      if (!this.context) throw new Error('无法获取 webgpu context');

      this.format = navigator.gpu.getPreferredCanvasFormat();

      // ★ 关键：alphaMode 用 premultiplied，让 canvas 透明，露出下层网格
      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: 'premultiplied',
      });

      await loadShaders();

      const lineModule = this.device.createShaderModule({ code: LINE_WGSL_CODE });
      const dotModule  = this.device.createShaderModule({ code: DOT_WGSL_CODE });

      // ★ 关键：加色混合（src + dst），配合预乘 alpha，产生荧光叠加效果
      const blend = {
        color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      };

      this.linePipeline = this.device.createRenderPipeline({
        layout: 'auto',
        vertex:   { module: lineModule, entryPoint: 'vs_main' },
        fragment: { module: lineModule, entryPoint: 'fs_main', targets: [{ format: this.format, blend }] },
        primitive: { topology: 'triangle-strip' },
      });

      this.dotPipeline = this.device.createRenderPipeline({
        layout: 'auto',
        vertex:   { module: dotModule, entryPoint: 'vs_main' },
        fragment: { module: dotModule, entryPoint: 'fs_main', targets: [{ format: this.format, blend }] },
        primitive: { topology: 'triangle-strip' },
      });

      // ★ uniform 16 字节：vec2(resolution) + f32(lineWidth) + f32(pad)
      this.uniformBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      this.ensureLineCapacity(4096);
      this.ensureDotCapacity(4096);
    }

    ensureLineCapacity(n) {
      if (this.maxLines >= n && this.lineBuffer) return;
      const cap = Math.max(n, 4096);
      this.lineBuffer?.destroy();
      this.lineBuffer = this.device.createBuffer({
        size: cap * 8 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.maxLines = cap;
      this.lineBindGroup = this.device.createBindGroup({
        layout: this.linePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: { buffer: this.lineBuffer } },
        ],
      });
    }

    ensureDotCapacity(n) {
      if (this.maxDots >= n && this.dotBuffer) return;
      const cap = Math.max(n, 4096);
      this.dotBuffer?.destroy();
      this.dotBuffer = this.device.createBuffer({
        size: cap * 8 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.maxDots = cap;
      this.dotBindGroup = this.device.createBindGroup({
        layout: this.dotPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: { buffer: this.dotBuffer } },
        ],
      });
    }

    setSize(w, h) {
      this.width = w;
      this.height = h;
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
    }

    render(lines, dots, lineWidth) {
      const lineCount = Math.floor(lines.length / 8);
      const dotCount = Math.floor(dots.length / 8);

      if (lineCount > 0) {
        this.ensureLineCapacity(lineCount);
        this.device.queue.writeBuffer(this.lineBuffer, 0, lines, 0, lineCount * 8);
      }
      if (dotCount > 0) {
        this.ensureDotCapacity(dotCount);
        this.device.queue.writeBuffer(this.dotBuffer, 0, dots, 0, dotCount * 8);
      }

      const uni = new Float32Array(4);
      uni[0] = this.width;
      uni[1] = this.height;
      uni[2] = lineWidth;
      uni[3] = 0;
      this.device.queue.writeBuffer(this.uniformBuffer, 0, uni);

      const encoder = this.device.createCommandEncoder();
      const view = this.context.getCurrentTexture().createView();

      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view,
          // ★ 透明清屏，露出下层 grid canvas
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });

      if (lineCount > 0) {
        pass.setPipeline(this.linePipeline);
        pass.setBindGroup(0, this.lineBindGroup);
        pass.draw(4, lineCount);
      }
      if (dotCount > 0) {
        pass.setPipeline(this.dotPipeline);
        pass.setBindGroup(0, this.dotBindGroup);
        pass.draw(4, dotCount);
      }

      pass.end();
      this.device.queue.submit([encoder.finish()]);
    }

    destroy() {
      this.lineBuffer?.destroy();
      this.dotBuffer?.destroy();
      this.uniformBuffer?.destroy();
      this.device?.destroy?.();
    }
  }

  global.RendererGPU = RendererGPU;
})(window);