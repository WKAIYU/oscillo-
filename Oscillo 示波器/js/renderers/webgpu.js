// WebGPU 渲染器
// 每批次一个 dynamic uniform 偏移，layout 统一
// 线数据：每段 4 个 f32；点数据：每个 2 个 f32

const LINE_WGSL = `
struct Uniforms {
  resolution : vec2<f32>,
  width      : f32,
  _pad0      : f32,
  color      : vec4<f32>,
};
struct Line { p0 : vec2<f32>, p1 : vec2<f32> };

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var<storage, read> lines : array<Line>;

struct VSIn {
  @builtin(vertex_index) vi : u32,
  @builtin(instance_index) ii : u32,
};
struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) color : vec4<f32>,
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
  let halfW = max(u.width, 0.5) * 0.5;
  var base = a;
  if (in.vi >= 2u) { base = b; }
  var sgn = -1.0;
  if (in.vi == 1u || in.vi == 3u) { sgn = 1.0; }
  let world = base + nrm * halfW * sgn;
  let ndc = (world / u.resolution) * 2.0 - vec2<f32>(1.0, 1.0);
  var out : VSOut;
  out.pos = vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0);
  out.color = u.color;
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  let a = in.color.a;
  return vec4<f32>(in.color.rgb * a, a);
}
`;

const DOT_WGSL = `
struct Uniforms {
  resolution : vec2<f32>,
  size       : f32,
  _pad0      : f32,
  color      : vec4<f32>,
};
struct Dot { pos : vec2<f32> };

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var<storage, read> dots : array<Dot>;

struct VSIn {
  @builtin(vertex_index) vi : u32,
  @builtin(instance_index) ii : u32,
};
struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) color : vec4<f32>,
};

@vertex
fn vs_main(in : VSIn) -> VSOut {
  let dot = dots[in.ii];
  let halfSize = max(u.size, 1.0) * 0.5;
  var sx = -1.0;
  var sy = -1.0;
  if (in.vi == 1u || in.vi == 3u) { sx = 1.0; }
  if (in.vi == 2u || in.vi == 3u) { sy = 1.0; }
  let world = dot.pos + vec2<f32>(sx, sy) * halfSize;
  let ndc = (world / u.resolution) * 2.0 - vec2<f32>(1.0, 1.0);
  var out : VSOut;
  out.pos = vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0);
  out.color = u.color;
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  let a = in.color.a;
  return vec4<f32>(in.color.rgb * a, a);
}
`;

const UNIFORM_STRIDE = 256;   // minUniformBufferOffsetAlignment
const MAX_BATCHES = 32;

export class WebGPURenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.name = 'WebGPU';
    this.device = null;
    this.context = null;
    this.format = null;
    this.width = 1;
    this.height = 1;
    this.linePipeline = null;
    this.dotPipeline = null;
    this.uniformBuffer = null;
    this.lineBuffer = null;
    this.dotBuffer = null;
    this.lineBindGroup = null;
    this.dotBindGroup = null;
    this.maxLines = 0;
    this.maxDots = 0;
  }

  static isSupported() {
    return typeof navigator !== 'undefined' && !!navigator.gpu;
  }

  async init() {
    if (!WebGPURenderer.isSupported()) throw new Error('浏览器不支持 WebGPU');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('无法获取 GPU adapter');
    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext('webgpu');
    if (!this.context) throw new Error('无法获取 webgpu context');

    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
    });

    const lineMod = this.device.createShaderModule({ code: LINE_WGSL });
    const dotMod  = this.device.createShaderModule({ code: DOT_WGSL });

    const blend = {
      color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    };

    // 统一 bindGroupLayout：dynamic uniform + read-only-storage
    this.bgl = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 32 } },
        { binding: 1, visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' } },
      ],
    });
    const layout = this.device.createPipelineLayout({ bindGroupLayouts: [this.bgl] });

    this.linePipeline = this.device.createRenderPipeline({
      layout,
      vertex: { module: lineMod, entryPoint: 'vs_main' },
      fragment: { module: lineMod, entryPoint: 'fs_main',
        targets: [{ format: this.format, blend }] },
      primitive: { topology: 'triangle-strip' },
    });
    this.dotPipeline = this.device.createRenderPipeline({
      layout,
      vertex: { module: dotMod, entryPoint: 'vs_main' },
      fragment: { module: dotMod, entryPoint: 'fs_main',
        targets: [{ format: this.format, blend }] },
      primitive: { topology: 'triangle-strip' },
    });

    this.uniformBuffer = this.device.createBuffer({
      size: UNIFORM_STRIDE * MAX_BATCHES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._ensureLineCapacity(4096);
    this._ensureDotCapacity(4096);
  }

  _ensureLineCapacity(n) {
    if (this.maxLines >= n && this.lineBuffer) return;
    const cap = Math.max(n, 4096);
    this.lineBuffer?.destroy();
    this.lineBuffer = this.device.createBuffer({
      size: cap * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.maxLines = cap;
    this.lineBindGroup = this.device.createBindGroup({
      layout: this.bgl,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer, size: 32 } },
        { binding: 1, resource: { buffer: this.lineBuffer } },
      ],
    });
  }

  _ensureDotCapacity(n) {
    if (this.maxDots >= n && this.dotBuffer) return;
    const cap = Math.max(n, 4096);
    this.dotBuffer?.destroy();
    this.dotBuffer = this.device.createBuffer({
      size: cap * 8,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.maxDots = cap;
    this.dotBindGroup = this.device.createBindGroup({
      layout: this.bgl,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer, size: 32 } },
        { binding: 1, resource: { buffer: this.dotBuffer } },
      ],
    });
  }

  resize(cssW, cssH, dpr) {
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    this.canvas.width = w;
    this.canvas.height = h;
    this.width = w;
    this.height = h;
  }

  render(batches) {
    // 汇总数据
    const lineChunks = [];
    const dotChunks = [];
    const meta = [];
    let totalLines = 0, totalDots = 0;

    for (const b of batches) {
      if (b.type === 'lines') {
        const count = b.data.length / 4;
        lineChunks.push({ data: b.data, count });
        meta.push({ type: 'line', count, offset: totalLines, uniIdx: meta.length, b });
        totalLines += count;
      } else if (b.type === 'dots') {
        const count = b.data.length / 2;
        dotChunks.push({ data: b.data, count });
        meta.push({ type: 'dot', count, offset: totalDots, uniIdx: meta.length, b });
        totalDots += count;
      }
    }

    // 上传 storage
    if (totalLines > 0) {
      this._ensureLineCapacity(totalLines);
      let off = 0;
      for (const c of lineChunks) {
        this.device.queue.writeBuffer(this.lineBuffer, off * 16, c.data);
        off += c.count;
      }
    }
    if (totalDots > 0) {
      this._ensureDotCapacity(totalDots);
      let off = 0;
      for (const c of dotChunks) {
        this.device.queue.writeBuffer(this.dotBuffer, off * 8, c.data);
        off += c.count;
      }
    }

    // 上传 uniforms（每批次一个 32 字节块）
    const uni = new Float32Array(8);
    for (const m of meta) {
      uni[0] = this.width;
      uni[1] = this.height;
      uni[2] = m.b.width || m.b.size || 1;
      uni[3] = 0;
      uni[4] = m.b.color[0];
      uni[5] = m.b.color[1];
      uni[6] = m.b.color[2];
      uni[7] = m.b.color[3];
      this.device.queue.writeBuffer(this.uniformBuffer, m.uniIdx * UNIFORM_STRIDE, uni);
    }

    // 渲染
    const encoder = this.device.createCommandEncoder();
    const view = this.context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    for (const m of meta) {
      const dynOff = m.uniIdx * UNIFORM_STRIDE;
      if (m.type === 'line') {
        pass.setPipeline(this.linePipeline);
        pass.setBindGroup(0, this.lineBindGroup, [dynOff]);
        pass.draw(4, m.count, 0, m.offset);
      } else {
        pass.setPipeline(this.dotPipeline);
        pass.setBindGroup(0, this.dotBindGroup, [dynOff]);
        pass.draw(4, m.count, 0, m.offset);
      }
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