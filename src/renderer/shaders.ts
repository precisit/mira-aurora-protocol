/**
 * WGSL shader sources for Fas 0.
 *
 * One pipeline for now: an instanced, tinted, textured quad batch.
 * Every visual (parallax layers, tiles, later sprites) is drawn through it:
 *   - vertex buffer 0: shared unit-quad corner positions (6 vertices),
 *   - vertex buffer 1: per-instance data (position/size/uv/color),
 *   - uniform group 0: virtual-resolution → NDC transform,
 *   - bind group 1:    texture + sampler.
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

struct Instance {
  pos:   vec2<f32>,  // top-left corner in virtual pixels
  size:  vec2<f32>,  // width/height in virtual pixels
  uv0:   vec2<f32>,  // texture-space top-left
  uv1:   vec2<f32>,  // texture-space bottom-right
  color: vec4<f32>,  // rgba tint, 0..1
};

struct VsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
};

@vertex
fn vsMain(
  @location(0) corner: vec2<f32>,
  @location(1) inst: Instance,
) -> VsOut {
  let world = inst.pos + corner * inst.size;
  let uv = mix(inst.uv0, inst.uv1, corner);
  let clip = vec4<f32>(
    world.x * view.sx + view.tx,
    world.y * view.sy + view.ty,
    0.0,
    1.0
  );
  return VsOut(clip, uv, inst.color);
}

@group(1) @binding(0) var texSampler: sampler;
@group(1) @binding(1) var texTexture: texture_2d<f32>;

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4<f32> {
  let sampled = textureSample(texTexture, texSampler, in.uv);
  return sampled * in.color;
}
`;
