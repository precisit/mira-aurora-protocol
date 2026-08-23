import { POST_SHADER_WGSL } from './shaders';

/**
 * BloomPass — bright-pass extraction + separable gaussian blur + composite
 * (PLAN.md §6: "bloom post-pass").
 *
 * The scene is rendered by the renderer into an offscreen texture; this pass
 * then encodes three or four fullscreen passes into the same command encoder:
 *
 *   scene ──bright(knee)──▶ brightTex ──blur H──▶ blurTex ──blur V──▶ brightTex
 *                                              composite(scene + bloom·k) ──▶ swapchain
 *
 * The two intermediate textures run at reduced resolution
 * (`downsample`, default ½) to keep the blur cheap on mobile.
 *
 * Everything is defensive: pipeline/texture creation failures mark the pass
 * unavailable and frames degrade gracefully to a plain scene copy.
 * Parameter sanitization and the knee curve are exported as pure functions
 * for unit testing (see tests/bloom.test.ts).
 */

export interface BloomParams {
  /** Luminance threshold above which pixels start blooming (0..4). */
  threshold: number;
  /** Soft-knee width around the threshold; 0 = hard cut (0..2). */
  knee: number;
  /** Bloom contribution when compositing (0..8). */
  intensity: number;
  /** Blur radius along each axis, in half-res texels (0.5..8). */
  radius: number;
  /** Intermediate buffer downsample factor (integer 1..4). */
  downsample: number;
}

export const DEFAULT_BLOOM_PARAMS: Readonly<BloomParams> = {
  threshold: 0.62,
  knee: 0.4,
  intensity: 0.95,
  radius: 2.2,
  downsample: 2,
};

function sanitize(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Merge user-supplied parameters over the current ones, replacing non-finite
 * values with the previous/default value and clamping everything to sane
 * ranges so hostile input can never reach the shader.
 */
export function resolveBloomParams(patch?: Partial<BloomParams>): BloomParams {
  const p = patch ?? {};
  const d = DEFAULT_BLOOM_PARAMS;
  return {
    threshold: sanitize(p.threshold, d.threshold, 0, 4),
    knee: sanitize(p.knee, d.knee, 0, 2),
    intensity: sanitize(p.intensity, d.intensity, 0, 8),
    radius: sanitize(p.radius, d.radius, 0.5, 8),
    downsample: Math.round(sanitize(p.downsample, d.downsample, 1, 4)),
  };
}

/**
 * Smooth-knee brightness extraction weight (Unity-style quadratic knee).
 * Returns the fraction of `brightness` that survives the threshold.
 * Mirrors `brightFactor()` in POST_SHADER_WGSL — keep both in sync.
 */
export function brightFactor(
  brightness: number,
  threshold: number,
  knee: number,
): number {
  if (!Number.isFinite(brightness) || brightness <= 1e-6) return 0;
  const t = Number.isFinite(threshold) ? Math.max(0, threshold) : 0;
  const k = Number.isFinite(knee) ? Math.max(0, knee) : 0;
  const inv = 1 / brightness;
  if (k <= 1e-4) {
    return Math.max(0, brightness - t) * inv;
  }
  const soft = Math.min(k * 2, Math.max(0, brightness - t + k));
  const quadratic = (soft * soft) / (4 * k);
  return Math.max(quadratic, brightness - t) * inv;
}

const SCENE_FORMAT: GPUTextureFormat = 'rgba8unorm';
const POST_UNIFORM_BYTES = 48; // struct PostParams (12 floats)

type PassKind = 'fsBright' | 'fsBlur' | 'fsComposite';

interface BloomBindGroups {
  bright: GPUBindGroup;
  blurReadBright: GPUBindGroup;
  blurReadBlur: GPUBindGroup;
  composite: GPUBindGroup;
}

export class BloomPass {
  private readonly device: GPUDevice;
  private readonly canvasFormat: GPUTextureFormat;

  private module!: GPUShaderModule;
  private sampler!: GPUSampler;
  private bglSingle!: GPUBindGroupLayout; // params + sampler + source
  private bglBloom!: GPUBindGroupLayout; // params + sampler + source + bloom
  private pipelineBright!: GPURenderPipeline;
  private pipelineBlur!: GPURenderPipeline;
  private pipelineComposite!: GPURenderPipeline;
  private ubBright!: GPUBuffer;
  private ubBlurH!: GPUBuffer;
  private ubBlurV!: GPUBuffer;
  private ubComposite!: GPUBuffer;
  private blackView!: GPUTextureView;

  private brightTexture: GPUTexture | null = null;
  private blurTexture: GPUTexture | null = null;
  private brightView: GPUTextureView | null = null;
  private blurView: GPUTextureView | null = null;
  private bindGroups: BloomBindGroups | null = null;

  private sceneWidth = 0;
  private sceneHeight = 0;
  private halfWidth = 1;
  private halfHeight = 1;
  private lastSceneView: GPUTextureView | null = null;
  private scratch = new Float32Array(POST_UNIFORM_BYTES / 4);

  private _params: BloomParams = { ...DEFAULT_BLOOM_PARAMS };
  private _available = true;

  public constructor(device: GPUDevice, canvasFormat: GPUTextureFormat) {
    this.device = device;
    this.canvasFormat = canvasFormat;
    try {
      this.module = device.createShaderModule({ code: POST_SHADER_WGSL });
      this.sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      });

      // GPUShaderStage constants are not exposed by the TS DOM lib;
      // spec-stable numeric values: FRAGMENT = 0x2.
      this.bglSingle = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: 0x2,
            buffer: { type: 'uniform' },
          },
          {
            binding: 1,
            visibility: 0x2,
            sampler: { type: 'filtering' },
          },
          {
            binding: 2,
            visibility: 0x2,
            texture: { sampleType: 'float' },
          },
        ],
      });
      this.bglBloom = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: 0x2, buffer: { type: 'uniform' } },
          { binding: 1, visibility: 0x2, sampler: { type: 'filtering' } },
          { binding: 2, visibility: 0x2, texture: { sampleType: 'float' } },
          { binding: 3, visibility: 0x2, texture: { sampleType: 'float' } },
        ],
      });

      this.pipelineBright = this.createPipeline('fsBright', this.bglSingle);
      this.pipelineBlur = this.createPipeline('fsBlur', this.bglSingle);
      this.pipelineComposite = this.createPipeline('fsComposite', this.bglBloom);

      const ub = (): GPUBuffer =>
        device.createBuffer({
          size: POST_UNIFORM_BYTES,
          usage: 0x0040 /* UNIFORM */ | 0x0008 /* COPY_DST */,
        });
      this.ubBright = ub();
      this.ubBlurH = ub();
      this.ubBlurV = ub();
      this.ubComposite = ub();

      // 1×1 black fallback sampled when bloom is unavailable/disabled.
      const black = device.createTexture({
        size: [1, 1],
        format: SCENE_FORMAT,
        usage: 0x04 /* TEXTURE_BINDING */ | 0x02 /* COPY_DST */,
      });
      device.queue.writeTexture(
        { texture: black },
        new Uint8Array([0, 0, 0, 255]),
        { bytesPerRow: 4, rowsPerImage: 1 },
        [1, 1],
      );
      this.blackView = black.createView();
    } catch (error) {
      this._available = false;
      console.warn('[bloom] init failed — bloom disabled:', error);
    }
  }

  /** False if GPU setup failed at any point; frames degrade to plain copy. */
  public get available(): boolean {
    return this._available;
  }

  /** Current sanitized parameters. */
  public get params(): Readonly<BloomParams> {
    return this._params;
  }

  /**
   * Update parameters (merged over the current ones, then sanitized).
   * If the downsample factor changed, intermediate buffers are rebuilt.
   */
  public configure(patch: Partial<BloomParams>): void {
    const beforeDownsample = this._params.downsample;
    this._params = resolveBloomParams({ ...this._params, ...patch });
    if (
      this._available &&
      this._params.downsample !== beforeDownsample &&
      this.lastSceneView &&
      this.sceneWidth > 0 &&
      this.sceneHeight > 0
    ) {
      // Force a rebuild of the half-res targets with the new factor.
      const sw = this.sceneWidth;
      const sh = this.sceneHeight;
      this.sceneWidth = 0;
      this.sceneHeight = 0;
      this.bindGroups = null;
      this.resize(sw, sh, this.lastSceneView);
    }
  }

  /**
   * (Re)create the intermediate textures + bind groups for a scene of the
   * given pixel size. Safe to call every resize; failures disable the pass.
   */
  public resize(sceneWidth: number, sceneHeight: number, sceneView: GPUTextureView): void {
    if (!this._available) return;
    const sw = Math.max(1, Math.floor(sceneWidth));
    const sh = Math.max(1, Math.floor(sceneHeight));
    this.lastSceneView = sceneView;
    if (
      sw === this.sceneWidth &&
      sh === this.sceneHeight &&
      this.bindGroups &&
      this.brightView
    ) {
      return;
    }

    const hw = Math.max(1, Math.floor(sw / this._params.downsample));
    const hh = Math.max(1, Math.floor(sh / this._params.downsample));

    try {
      this.brightTexture?.destroy();
      this.blurTexture?.destroy();
      this.brightTexture = null;
      this.blurTexture = null;

      const makeTarget = (): { texture: GPUTexture; view: GPUTextureView } => {
        const texture = this.device.createTexture({
          size: [hw, hh],
          format: SCENE_FORMAT,
          usage:
            0x04 /* TEXTURE_BINDING */ |
            0x10 /* RENDER_ATTACHMENT */,
        });
        return { texture, view: texture.createView() };
      };

      const bright = makeTarget();
      const blur = makeTarget();
      this.brightTexture = bright.texture;
      this.blurTexture = blur.texture;
      this.brightView = bright.view;
      this.blurView = blur.view;
      this.halfWidth = hw;
      this.halfHeight = hh;

      const group = (layout: GPUBindGroupLayout, ub: GPUBuffer, views: GPUTextureView[]): GPUBindGroup =>
        this.device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: { buffer: ub } },
            { binding: 1, resource: this.sampler },
            ...views.map((view, i) => ({ binding: 2 + i, resource: view })),
          ],
        });

      this.bindGroups = {
        bright: group(this.bglSingle, this.ubBright, [sceneView]),
        blurReadBright: group(this.bglSingle, this.ubBlurH, [this.brightView]),
        blurReadBlur: group(this.bglSingle, this.ubBlurV, [this.blurView]),
        composite: group(this.bglBloom, this.ubComposite, [sceneView, this.brightView]),
      };

      this.sceneWidth = sw;
      this.sceneHeight = sh;
    } catch (error) {
      this._available = false;
      console.warn('[bloom] resource creation failed — bloom disabled:', error);
    }
  }

  /**
   * Encode all post-processing passes into `encoder`. The final pass renders
   * into `targetView` (the swapchain). If bloom is unavailable, a single
   * composite copy with zero-intensity bloom still presents the scene.
   */
  public encode(encoder: GPUCommandEncoder, sceneView: GPUTextureView, targetView: GPUTextureView): void {
    const p = this._params;
    const ready =
      this._available && this.bindGroups && this.brightView && this.blurView;

    if (ready) {
      this.writeParams(this.ubBright, 1 / this.sceneWidth, 1 / this.sceneHeight, 0, 0, p.threshold, p.knee, 0);
      this.writeParams(this.ubBlurH, 1 / this.halfWidth, 1 / this.halfHeight, p.radius, 0, 0, 0, 0);
      this.writeParams(this.ubBlurV, 1 / this.halfWidth, 1 / this.halfHeight, 0, p.radius, 0, 0, 0);
      this.writeParams(this.ubComposite, 1, 1, 0, 0, 0, 0, p.intensity);

      const bg = this.bindGroups!;
      this.fullscreen(encoder, this.brightView!, this.pipelineBright, bg.bright);
      this.fullscreen(encoder, this.blurView!, this.pipelineBlur, bg.blurReadBright);
      this.fullscreen(encoder, this.brightView!, this.pipelineBlur, bg.blurReadBlur);
      this.fullscreen(encoder, targetView, this.pipelineComposite, bg.composite);
      return;
    }

    // Degraded path: present the scene untouched (black bloom, no gain).
    this.writeParams(this.ubComposite, 1, 1, 0, 0, 0, 0, 0);
    const bgFallback = this.device.createBindGroup({
      layout: this.bglBloom,
      entries: [
        { binding: 0, resource: { buffer: this.ubComposite } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: sceneView },
        { binding: 3, resource: this.blackView },
      ],
    });
    this.fullscreen(encoder, targetView, this.pipelineComposite, bgFallback);
  }

  /** Uniform layout: texelSize.xy, direction.xy, threshold, knee, intensity, pad. */
  private writeParams(
    buffer: GPUBuffer,
    texelX: number,
    texelY: number,
    dirX: number,
    dirY: number,
    threshold: number,
    knee: number,
    intensity: number,
  ): void {
    const f = this.scratch;
    f[0] = texelX;
    f[1] = texelY;
    f[2] = dirX;
    f[3] = dirY;
    f[4] = threshold;
    f[5] = knee;
    f[6] = intensity;
    f.fill(0, 7);
    this.device.queue.writeBuffer(buffer, 0, f.buffer, 0, POST_UNIFORM_BYTES);
  }

  private fullscreen(
    encoder: GPUCommandEncoder,
    targetView: GPUTextureView,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
  ): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: targetView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3); // fullscreen triangle
    pass.end();
  }

  private createPipeline(entryPoint: PassKind, layout: GPUBindGroupLayout): GPURenderPipeline {
    return this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module: this.module, entryPoint: 'vsFull' },
      fragment: {
        module: this.module,
        entryPoint,
        targets: [{ format: entryPoint === 'fsComposite' ? this.canvasFormat : SCENE_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }
}
