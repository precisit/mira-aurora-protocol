/**
 * WGSL shader sources (A1 renderer wave).
 *
 * SPRITE_SHADER_WGSL — one instanced, tinted, textured quad pipeline shared
 * by every visual (parallax layers, tiles, sprites). Per-instance data adds
 * a neon-glow color and a blend-mode flag so additive sprites batch through
 * the same pipeline pair:
 *   - vertex buffer 0: shared unit-quad corner positions (6 vertices),
 *   - vertex buffer 1: per-instance data (pos/size/uv/tint/glow/params),
 *   - uniform group 0: virtual-resolution → NDC transform,
 *   - bind group 1:    texture + sampler.
 *
 * POST_SHADER_WGSL — bloom post-processing: fullscreen-triangle passes for
 * bright-pass extraction, separable 9-tap gaussian blur and final
 * scene + bloom compositing onto the swapchain.
 */

export const SPRITE_SHADER_WGSL = /* wgsl */ `
struct ViewTransform {
  // ndc.x = x * sx + tx ; ndc.y = y * sy + ty
  sx: f32,
  sy: f32,
  tx: f32,
  ty: f32,
};

@group(0) @binding(0) var<uniform> view: ViewTransform;

struct VsIn {
  @location(0) corner: vec2<f32>,
  @location(1) ipos: vec2<f32>,
  @location(2) isize: vec2<f32>,
  @location(3) iuv0: vec2<f32>,
  @location(4) iuv1: vec2<f32>,
  @location(5) icolor: vec4<f32>,
  @location(6) iglow: vec4<f32>,
  @location(7) iparams: vec4<f32>,   // x = blend mode (0 normal, 1 additive)
};

struct VsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
  @location(2) glow: vec4<f32>,
  @location(3) @interpolate(flat) additive: u32,
};

@vertex
fn vsMain(in: VsIn) -> VsOut {
  let world = in.ipos + in.corner * in.isize;
  let uv = mix(in.iuv0, in.iuv1, in.corner);
  let clip = vec4<f32>(
    world.x * view.sx + view.tx,
    world.y * view.sy + view.ty,
    0.0,
    1.0
  );
  return VsOut(clip, uv, in.icolor, in.iglow, u32(in.iparams.x + 0.5));
}

@group(1) @binding(0) var texSampler: sampler;
@group(1) @binding(1) var texTexture: texture_2d<f32>;

const LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let sampled = textureSample(texTexture, texSampler, in.uv);
  let luminance = dot(sampled.rgb, LUMA);
  // Neon halo: emits the sprite's glow color where the texture is bright.
  let halo = in.glow.rgb * luminance * in.glow.a * in.color.a;
  let rgb = sampled.rgb * in.color.rgb + halo;
  let alpha = sampled.a * in.color.a;
  if (in.additive == 1u) {
    // Premultiplied output for the one / one-minus-src-alpha blend state.
    return vec4<f32>(rgb * alpha, alpha);
  }
  return vec4<f32>(rgb, alpha);
}
`;

/**
 * Gaussian tap weights (9-tap, symmetric). The array lists all nine taps;
 * the blur shader stores the five unique weights (center outward).
 */
export const GAUSSIAN_TAPS_9 = [
  0.0162162162, 0.0540540541, 0.1216216216, 0.1945945946, 0.227027027,
  0.1945945946, 0.1216216216, 0.0540540541, 0.0162162162,
] as const;

const HALF_TAPS_WGSL = GAUSSIAN_TAPS_9.slice(4)
  .map((w) => w.toFixed(10))
  .join(', ');

export const POST_SHADER_WGSL = /* wgsl */ `
struct PostParams {
  texelSize: vec2<f32>,   // 1 / source size
  direction: vec2<f32>,   // blur axis * radius (in texels)
  threshold: f32,
  knee: f32,
  intensity: f32,
  pad0: f32,
};

@group(0) @binding(0) var<uniform> params: PostParams;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var srcTex: texture_2d<f32>;
// Binding 3 is only statically used by fsComposite; bright/blur pipelines
// are created with a layout that omits it.
@group(0) @binding(3) var bloomTex: texture_2d<f32>;

struct FullOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vsFull(@builtin(vertex_index) vi: u32) -> FullOut {
  var corners = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(3.0, 1.0)
  );
  let xy = corners[vi];
  return FullOut(
    vec4<f32>(xy, 0.0, 1.0),
    vec2<f32>(xy.x * 0.5 + 0.5, xy.y * 0.5 + 0.5)
  );
}

// Mirrors brightFactor() in BloomPass.ts — keep both in sync.
fn brightFactor(brightness: f32, threshold: f32, knee: f32) -> f32 {
  if (brightness <= 0.000001) {
    return 0.0;
  }
  let inv = 1.0 / brightness;
  if (knee <= 0.0001) {
    return max(brightness - threshold, 0.0) * inv;
  }
  let soft = clamp(brightness - threshold + knee, 0.0, knee * 2.0);
  let quadratic = soft * soft / (4.0 * knee);
  return max(quadratic, brightness - threshold) * inv;
}

@fragment
fn fsBright(in: FullOut) -> @location(0) vec4<f32> {
  let c = textureSample(srcTex, samp, in.uv).rgb;
  let br = max(c.r, max(c.g, c.b));
  let f = brightFactor(br, params.threshold, params.knee);
  return vec4<f32>(c * f, 1.0);
}

@fragment
fn fsBlur(in: FullOut) -> @location(0) vec4<f32> {
  var taps = array<f32, 5>(${HALF_TAPS_WGSL});
  let stepVec = params.direction * params.texelSize;
  var acc = vec3<f32>(0.0, 0.0, 0.0);
  for (var i = -4; i <= 4; i++) {
    let w = taps[abs(i)];
    acc = acc + textureSample(srcTex, samp, in.uv + stepVec * f32(i)).rgb * w;
  }
  return vec4<f32>(acc, 1.0);
}

@fragment
fn fsComposite(in: FullOut) -> @location(0) vec4<f32> {
  let scene = textureSample(srcTex, samp, in.uv);
  let bloom = textureSample(bloomTex, samp, in.uv);
  let c = scene.rgb + bloom.rgb * params.intensity;
  return vec4<f32>(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;
