import { BloomPass, type BloomParams } from './BloomPass';
import { SPRITE_SHADER_WGSL } from './shaders';
import {
  INSTANCE_STRIDE_BYTES,
  SpriteBatch,
  groupQuads,
  type TaggedQuad,
} from './SpriteBatch';
import {
  MAX_DEVICE_PIXEL_RATIO,
  VIRTUAL_HEIGHT,
  VIRTUAL_WIDTH,
  type Rgba,
  type SpriteDraw,
  type ViewBounds,
} from './types';

/**
 * WebGPU renderer (A1 wave).
 *
 * Frame flow — everything is instanced and batched (PLAN.md §6):
 *   1. `beginFrame` starts a render pass into an offscreen scene texture.
 *   2. `drawSprites` queues quads; at `endFrame` they are packed once and
 *      drawn as one instanced draw call per (texture × blend-mode) group.
 *   3. The bloom post-pass (bright → separable blur → composite) presents
 *      the scene to the canvas; if bloom setup failed it degrades to a
 *      plain copy so rendering never dies because of post-processing.
 *
 * Letterbox: the view always fills the window's height around the fixed
 * 1280×720 gameplay area; wider screens get parallax-only side gutters.
 */

export { MAX_DEVICE_PIXEL_RATIO, VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from './types';
export type { Rgba, SpriteBlendMode, SpriteDraw, ViewBounds } from './types';

export interface BloomState {
  readonly available: boolean;
  readonly params: Readonly<BloomParams>;
}

/** Thrown for any renderer setup failure — message is user-displayable. */
export class WebGPURendererError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'WebGPURendererError';
  }
}

/**
 * WebGPU usage flags (spec-stable numeric values).
 * TypeScript's DOM lib types the `usage` fields but does not expose the
 * runtime constant objects (`GPUBufferUsage` etc.), so we declare them here.
 * Source: https://gpuweb.github.io/gpuweb/#buffer-usage
 */
const BUFFER_USAGE = {
  COPY_DST: 0x0008,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
} as const;

const TEXTURE_USAGE = {
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  RENDER_ATTACHMENT: 0x10,
} as const;

/** Offscreen format for the scene + bloom targets (universally filterable). */
const SCENE_FORMAT: GPUTextureFormat = 'rgba8unorm';

interface TextureEntry {
  texture: GPUTexture;
  bindGroup: GPUBindGroup;
  width: number;
  height: number;
}

/** Unit quad corners as two triangles: (0,0)-(1,0)-(1,1) and (0,0)-(1,1)-(0,1). */
const QUAD_CORNERS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);

interface EncodedBatch {
  entry: TextureEntry;
  additive: boolean;
  startSprite: number;
  spriteCount: number;
}

/**
 * WebGPU renderer with:
 *  - defensive init (navigator.gpu / adapter / device all guarded),
 *  - height-fills letterbox around a fixed 1280×720 virtual resolution,
 *  - instanced sprite batching (one draw call per texture/blend group),
 *  - bloom post-processing with graceful degradation,
 *  - neon-glow sprites via additive blending + per-sprite glow color.
 */
export class WebGPURenderer {
  private canvas!: HTMLCanvasElement;
  private context!: GPUCanvasContext;
  private device!: GPUDevice;
  private format!: GPUTextureFormat;

  // Sprite pipeline resources.
  private bglView!: GPUBindGroupLayout;
  private bglTexture!: GPUBindGroupLayout;
  private pipelineNormal!: GPURenderPipeline;
  private pipelineAdditive!: GPURenderPipeline;
  private uniformBuffer!: GPUBuffer;
  private quadVertexBuffer!: GPUBuffer;
  private batch: SpriteBatch | null = null;

  // Offscreen scene target consumed by the post pass.
  private sceneTexture: GPUTexture | null = null;
  private sceneView: GPUTextureView | null = null;

  private bloomPass: BloomPass | null = null;

  private textures = new Map<string, TextureEntry>();
  private queuedSprites = new Map<string, SpriteDraw[]>();

  private renderPass: GPURenderPassEncoder | null = null;
  private commandEncoder: GPUCommandEncoder | null = null;

  private _viewBounds: ViewBounds = {
    left: 0,
    right: VIRTUAL_WIDTH,
    top: 0,
    bottom: VIRTUAL_HEIGHT,
  };
  private resizeObserver: ResizeObserver | null = null;
  private uniformBindGroupCache: GPUBindGroup | null = null;

  // ------------------------------------------------------------------ init

  /**
   * Initialize WebGPU on `canvas`. Throws {@link WebGPURendererError} with a
   * clear, user-facing message if anything in the chain is unavailable.
   */
  public async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;

    const gpu: GPU | undefined = navigator.gpu;
    if (!gpu) {
      throw new WebGPURendererError(
        'WebGPU is required to run Aurora Protocol, but this browser does not expose navigator.gpu.',
      );
    }

    let adapter: GPUAdapter | null;
    try {
      adapter = await gpu.requestAdapter();
    } catch (cause) {
      throw new WebGPURendererError(
        `GPU adapter request failed: ${(cause as Error).message ?? cause}`,
      );
    }
    if (!adapter) {
      throw new WebGPURendererError(
        'No suitable GPU adapter was found. Update your graphics drivers or try a WebGPU-capable browser.',
      );
    }

    let device: GPUDevice | null;
    try {
      device = await adapter.requestDevice();
    } catch (cause) {
      throw new WebGPURendererError(
        `GPU device request failed: ${(cause as Error).message ?? cause}`,
      );
    }
    if (!device) {
      throw new WebGPURendererError('GPU device request returned no device.');
    }
    this.device = device;
    device.lost.then((info) => {
      console.error(`[renderer] GPU device lost (${info.reason}): ${info.message}`);
    });

    const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!context) {
      throw new WebGPURendererError(
        'Canvas does not support the "webgpu" context on this browser.',
      );
    }
    this.context = context;
    this.format = gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });

    this.createGpuObjects();
    this.watchResize();
    this.resize();
  }

  private createGpuObjects(): void {
    const module = this.device.createShaderModule({ code: SPRITE_SHADER_WGSL });

    this.bglView = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: 0x1 /* GPUShaderStage.VERTEX — numeric, not in TS DOM lib */,
          buffer: { type: 'uniform' },
        },
      ],
    });
    this.bglTexture = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: 0x2 /* FRAGMENT */, sampler: { type: 'filtering' } },
        { binding: 1, visibility: 0x2 /* FRAGMENT */, texture: { sampleType: 'float' } },
      ],
    });
    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.bglView, this.bglTexture],
    });

    const vertexBuffers: GPUVertexBufferLayout[] = [
      {
        // buffer 0: unit-quad corners
        arrayStride: 2 * 4,
        attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
      },
      {
        // buffer 1: one instance per sprite (see INSTANCE_LAYOUT in SpriteBatch)
        arrayStride: INSTANCE_STRIDE_BYTES,
        stepMode: 'instance',
        attributes: [
          { shaderLocation: 1, offset: 0, format: 'float32x2' }, // pos
          { shaderLocation: 2, offset: 8, format: 'float32x2' }, // size
          { shaderLocation: 3, offset: 16, format: 'float32x2' }, // uv0
          { shaderLocation: 4, offset: 24, format: 'float32x2' }, // uv1
          { shaderLocation: 5, offset: 32, format: 'float32x4' }, // tint
          { shaderLocation: 6, offset: 48, format: 'float32x4' }, // glow
          { shaderLocation: 7, offset: 64, format: 'float32x4' }, // params
        ],
      },
    ];

    const makeSpritePipeline = (additive: boolean): GPURenderPipeline =>
      this.device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module, entryPoint: 'vsMain', buffers: vertexBuffers },
        fragment: {
          module,
          entryPoint: 'fsMain',
          targets: [
            {
              format: SCENE_FORMAT,
              blend: additive
                ? {
                    // Premultiplied additive: bright texels glow over the frame.
                    color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                  }
                : {
                    // Standard alpha blending so parallax layers can stack.
                    color: {
                      srcFactor: 'src-alpha',
                      dstFactor: 'one-minus-src-alpha',
                      operation: 'add',
                    },
                    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                  },
            },
          ],
        },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
      });

    this.pipelineNormal = makeSpritePipeline(false);
    this.pipelineAdditive = makeSpritePipeline(true);

    this.uniformBuffer = this.device.createBuffer({
      size: 16, // vec4<f32> worth of ViewTransform
      usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST,
    });

    this.quadVertexBuffer = this.device.createBuffer({
      size: QUAD_CORNERS.byteLength,
      usage: BUFFER_USAGE.VERTEX | BUFFER_USAGE.COPY_DST,
    });
    this.device.queue.writeBuffer(this.quadVertexBuffer, 0, QUAD_CORNERS);

    this.batch = new SpriteBatch(this.device);
    this.bloomPass = new BloomPass(this.device, this.format);

    // 1×1 white texture: lets tiles/rects draw as plain tinted quads.
    const white = this.device.createTexture({
      size: [1, 1],
      format: SCENE_FORMAT,
      usage: TEXTURE_USAGE.TEXTURE_BINDING | TEXTURE_USAGE.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: white },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4, rowsPerImage: 1 },
      [1, 1],
    );
    this.registerBindGroup('white', white, 1, 1, /* ownsTexture */ true);
  }

  private registerBindGroup(
    name: string,
    texture: GPUTexture,
    width: number,
    height: number,
    ownsTexture: boolean,
  ): void {
    const sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    const bindGroup = this.device.createBindGroup({
      layout: this.bglTexture,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: texture.createView() },
      ],
    });
    const existing = this.textures.get(name);
    if (existing && ownsTexture) existing.texture.destroy();
    this.textures.set(name, { texture, bindGroup, width, height });
  }

  // --------------------------------------------------------------- letterbox

  /**
   * Recompute backing-store size + letterbox after a canvas resize.
   *
   * Height always fills: scale = pixelHeight / 720. The virtual view spans
   * exactly 720 units vertically; horizontally it spans pixelWidth / scale,
   * centered on the 1280-unit gameplay area. Anything outside [0,1280] is
   * "gutter" where only parallax background is drawn.
   */
  public resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
    const cssWidth = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const cssHeight = Math.max(1, this.canvas.clientHeight || window.innerHeight);

    const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }

    const scale = pixelHeight / VIRTUAL_HEIGHT;
    const viewWidthVirtual = pixelWidth / scale;
    const gutterTotal = Math.max(0, viewWidthVirtual - VIRTUAL_WIDTH);
    this._viewBounds = {
      left: -gutterTotal / 2,
      right: VIRTUAL_WIDTH + gutterTotal / 2,
      top: 0,
      bottom: VIRTUAL_HEIGHT,
    };

    this.ensureSceneTarget(pixelWidth, pixelHeight);
  }

  /** (Re)create the offscreen scene target when the canvas size changes. */
  private ensureSceneTarget(pixelWidth: number, pixelHeight: number): void {
    if (
      this.sceneTexture &&
      this.sceneTexture.width === pixelWidth &&
      this.sceneTexture.height === pixelHeight &&
      this.sceneView
    ) {
      return;
    }
    try {
      this.sceneTexture?.destroy();
      this.sceneTexture = this.device.createTexture({
        size: [pixelWidth, pixelHeight],
        format: SCENE_FORMAT,
        usage:
          TEXTURE_USAGE.TEXTURE_BINDING |
          TEXTURE_USAGE.RENDER_ATTACHMENT |
          TEXTURE_USAGE.COPY_DST,
      });
      this.sceneView = this.sceneTexture.createView();
      this.bloomPass?.resize(pixelWidth, pixelHeight, this.sceneView);
    } catch (error) {
      console.error('[renderer] failed to resize offscreen scene target:', error);
    }
  }

  private watchResize(): void {
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas);
    } else {
      window.addEventListener('resize', () => this.resize());
    }
  }

  /** Visible bounds in virtual pixels for the current window shape. */
  public get viewBounds(): ViewBounds {
    return this._viewBounds;
  }

  // ------------------------------------------------------------- bloom API

  /** Tune the bloom post-pass (values are sanitized/clamped). */
  public setBloomOptions(patch: Partial<BloomParams>): void {
    this.bloomPass?.configure(patch);
  }

  /** Read-only snapshot of bloom availability + current parameters. */
  public get bloomState(): BloomState {
    return {
      available: this.bloomPass?.available ?? false,
      params: this.bloomPass?.params ?? { threshold: 0, knee: 0, intensity: 0, radius: 0, downsample: 1 },
    };
  }

  // ------------------------------------------------------------- frame flow

  /** Begin a frame; clears to `clear` and prepares the sprite pipeline. */
  public beginFrame(clear: Rgba = [0.02, 0.01, 0.07, 1]): void {
    if (!this.context || !this.batch) throw new WebGPURendererError('beginFrame called before init().');
    if (!this.sceneView) throw new WebGPURendererError('beginFrame called with no scene target.');

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.sceneView,
          clearValue: { r: clear[0], g: clear[1], b: clear[2], a: clear[3] },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.pipelineNormal);
    pass.setVertexBuffer(0, this.quadVertexBuffer);

    // Virtual-pixel → NDC transform over the current view bounds.
    const { left, right, top, bottom } = this._viewBounds;
    const sx = 2 / (right - left);
    const sy = -2 / (bottom - top); // negative: world Y grows downward
    const tx = -((right + left) / (right - left));
    const ty = (bottom + top) / (bottom - top);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, new Float32Array([sx, sy, tx, ty]));
    pass.setBindGroup(0, this.makeUniformBindGroup());

    this.commandEncoder = encoder;
    this.renderPass = pass;
  }

  private makeUniformBindGroup(): GPUBindGroup {
    if (!this.uniformBindGroupCache) {
      this.uniformBindGroupCache = this.device.createBindGroup({
        layout: this.bglView,
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
      });
    }
    return this.uniformBindGroupCache;
  }

  /**
   * Queue sprites drawn with `textureName` (registered via createTextureFromCanvas
   * or the built-in 'white'). Actual draws are batched per (texture × blend mode)
   * in endFrame — one instanced draw call per group.
   */
  public drawSprites(textureName: string, sprites: readonly SpriteDraw[]): void {
    if (!this.renderPass) throw new WebGPURendererError('drawSprites called outside begin/endFrame.');
    if (sprites.length === 0) return;
    const queue = this.queuedSprites.get(textureName);
    if (queue) queue.push(...sprites);
    else this.queuedSprites.set(textureName, [...sprites]);
  }

  /** Flush all queued sprite batches, run post-processing, submit, present. */
  public endFrame(): void {
    const pass = this.renderPass;
    const encoder = this.commandEncoder;
    const batch = this.batch;
    if (!pass || !encoder || !batch || !this.sceneView) {
      throw new WebGPURendererError('endFrame called without beginFrame.');
    }

    this.flushQueuedSprites(pass, batch);
    pass.end();

    this.bloomPass?.encode(encoder, this.sceneView, this.getCurrentTextureView());

    this.device.queue.submit([encoder.finish()]);
    this.renderPass = null;
    this.commandEncoder = null;
  }

  /**
   * Pack every queued group sequentially into the batch (one writeBuffer)
   * then issue one instanced draw call per group. Unknown texture names are
   * skipped with a warning instead of breaking the frame.
   */
  private flushQueuedSprites(pass: GPURenderPassEncoder, batch: SpriteBatch): void {
    if (this.queuedSprites.size === 0) return;

    interface PlannedBatch {
      entry: TextureEntry;
      additive: boolean;
      quads: SpriteDraw[];
    }
    const planned: PlannedBatch[] = [];
    let totalSprites = 0;

    for (const [textureName, sprites] of this.queuedSprites) {
      const tagged: TaggedQuad[] = [];
      for (const quad of sprites) tagged.push({ textureName, quad });
      for (const group of groupQuads(tagged)) {
        const entry = this.textures.get(group.textureName);
        if (!entry) {
          console.warn(
            `[renderer] unknown texture "${group.textureName}" — skipping ${group.quads.length} sprites`,
          );
          continue;
        }
        planned.push({ entry, additive: group.additive, quads: group.quads });
        totalSprites += group.quads.length;
      }
    }
    this.queuedSprites.clear();

    if (planned.length === 0) return;

    batch.ensureCapacity(totalSprites);
    const encoded: EncodedBatch[] = [];
    let cursor = 0;
    for (const plan of planned) {
      const start = cursor;
      cursor = batch.pack(start, plan.quads);
      encoded.push({
        entry: plan.entry,
        additive: plan.additive,
        startSprite: start,
        spriteCount: cursor - start,
      });
    }
    batch.upload(cursor);

    for (const draw of encoded) {
      if (draw.spriteCount <= 0) continue;
      pass.setPipeline(draw.additive ? this.pipelineAdditive : this.pipelineNormal);
      pass.setBindGroup(1, draw.entry.bindGroup);
      pass.setVertexBuffer(1, batch.gpuBuffer, draw.startSprite * INSTANCE_STRIDE_BYTES);
      pass.draw(QUAD_CORNERS.length / 2, draw.spriteCount); // 6 verts × N instances
    }
  }

  private getCurrentTextureView(): GPUTextureView {
    return this.context.getCurrentTexture().createView();
  }

  // ----------------------------------------------------------- texture mgmt

  /**
   * Upload an offscreen/DOM canvas (e.g. a procedurally generated parallax
   * layer) as a named GPU texture usable by the sprite pipelines.
   */
  public createTextureFromCanvas(name: string, source: OffscreenCanvas | HTMLCanvasElement): void {
    const width = source.width;
    const height = source.height;
    const texture = this.device.createTexture({
      size: [width, height],
      format: SCENE_FORMAT,
      // RENDER_ATTACHMENT is required by copyExternalImageToTexture.
      usage:
        TEXTURE_USAGE.TEXTURE_BINDING |
        TEXTURE_USAGE.COPY_DST |
        TEXTURE_USAGE.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source: source as GPUCopyExternalImageSource },
      { texture },
      [width, height],
    );
    this.registerBindGroup(name, texture, width, height, /* ownsTexture */ true);
  }

  /** Dimensions of a registered texture (for tiling math), or undefined. */
  public textureSize(name: string): { width: number; height: number } | undefined {
    const entry = this.textures.get(name);
    if (!entry) return undefined;
    return { width: entry.width, height: entry.height };
  }

  // -------------------------------------------------------------- fallback

  /**
   * Render the "WebGPU required" fallback page into `host`
   * (PLAN.md §6: WebGPU krävs — tydlig sida med förklaring och länk).
   */
  public static showFallbackMessage(host: HTMLElement | null): void {
    const target = host ?? document.body;
    target.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'fallback-box';
    box.innerHTML = `
      <h1>WebGPU required</h1>
      <p>
        Aurora Protocol needs <strong>WebGPU</strong>, which this browser does not
        currently provide. Please use a recent version of Chrome / Edge (desktop or
        Android) or Safari&nbsp;18+ on Apple Silicon / iPhone&nbsp;16+.
      </p>
      <p><a href="https://webgpureport.org" target="_blank" rel="noopener noreferrer">
        Check your browser's WebGPU support →</a></p>
    `;
    target.appendChild(box);
    target.classList.add('visible');
  }
}
