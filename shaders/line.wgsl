// 参考文件（内联版本在 js/renderers/webgpu.js 中）
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
  if (len < 0.0001) { dir = vec2<f32>(1.0, 0.0); } else { dir = dir / len; }
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