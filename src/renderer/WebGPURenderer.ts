import { SPRITE_SHADER_WGSL } from './shaders';

/**
 * Fixed virtual resolution (PLAN.md §6 "Skärm & letterbox"):
 * the gameplay area is always 1280×720. The view is scaled so that the
 * *height* always fills the screen; wider screens (iPhone landscape ≈ 19.5:9)
 * get extended background in the side gutters while the gameplay area stays
 * pixel-identical across devices.
 */
export const VIRTUAL_WIDTH = 1280;
export const VIRTUAL_HEIGHT = 720;

/** Battery-friendly devicePixelRatio cap (PLAN.md §6). */
export const MAX_DEVICE_PIXEL_RATIO = 2;

export type Rgba = readonly [number, number, number, number];

export interface SpriteDraw {
  /** Top-left corner in virtual pixels. May extend into side gutters. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Texture-space rect; defaults to the full texture. */
  u0?: number;
  v0?: number;
  u1?: number;
  v1?: number;
  tint?: Rgba;
}

/** Visible virtual-space bounds of the current frame, including gutters. */
export interface ViewBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
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
 * TypeScript's DOM lib types the `usage` fields as `GPUBufferUsageFlags` /
 * `GPUTextureUsageFlags` but does not expose the runtime constant objects
 * (`GPUBufferUsage` etc. live in @webgpu/types), so we declare the values here.
 * Source: https://gpuweb.github.io/gpuweb/#buffer-usage
 */
const BUFFER_USAGE = {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
} as const;

const TEXTURE_USAGE = {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
} as const;

interface TextureEntry {
  texture: GPUTexture;
  bindGroup: GPUBindGroup;
  width: number;
  height: number;
}

/** Byte layout must match `struct Instance` in shaders.ts (stride = 48). */
const INSTANCE_FLOATS_PER_SPRITE = 12;
const INSTANCE_STRIDE_BYTES = INSTANCE_FLOATS_PER_SPRITE * 4;
const INITIAL_MAX_SPRITES = 4096;

/** Unit quad corners as two triangles: (0,0)-(1,0)-(1,1) and (0,0)-(1,1)-(0,1). */
const QUAD_CORNERS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);

/**
 * WebGPU renderer skeleton with:
 *  - defensive init (navigator.gpu / adapter / device all guarded),
 *  - height-fills letterbox around a fixed 1280×720 virtual resolution,
 *  - one instanced quad/sprite pipeline ready for later waves.
 */
export class WebGPURenderer {
  private canvas!: HTMLCanvasElement;
  private context!: GPUCanvasContext;
  private device!: GPUDevice;
  private format!: GPUTextureFormat;

  private pipeline!: GPURenderPipeline;
  private uniformBuffer!: GPUBuffer;
  private quadVertexBuffer!: GPUBuffer;
  private instanceBuffer!: GPUBuffer;
  private instanceStaging = new Float32Array(INITIAL_MAX_SPRITES * INSTANCE_FLOATS_PER_SPRITE);
  private instanceCapacitySprites = INITIAL_MAX_SPRITES;

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

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vsMain',
        buffers: [
          {
            // buffer 0: unit-quad corners
            arrayStride: 2 * 4,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          },
          {
            // buffer 1: one instance per sprite
            arrayStride: INSTANCE_STRIDE_BYTES,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, offset: 0, format: 'float32x2' }, // pos
              { shaderLocation: 2, offset: 8, format: 'float32x2' }, // size
              { shaderLocation: 3, offset: 16, format: 'float32x2' }, // uv0
              { shaderLocation: 4, offset: 24, format: 'float32x2' }, // uv1
              { shaderLocation: 5, offset: 32, format: 'float32x4' }, // color
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fsMain',
        targets: [
          {
            format: this.format,
            blend: {
              // Premultiplied-free alpha blending so parallax layers can stack.
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

    this.uniformBuffer = this.device.createBuffer({
      size: 16, // vec4<f32> worth of ViewTransform
      usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST,
    });

    this.quadVertexBuffer = this.device.createBuffer({
      size: QUAD_CORNERS.byteLength,
      usage: BUFFER_USAGE.VERTEX | BUFFER_USAGE.COPY_DST,
    });
    this.device.queue.writeBuffer(this.quadVertexBuffer, 0, QUAD_CORNERS);

    this.instanceBuffer = this.createInstanceBuffer(this.instanceCapacitySprites);

    // 1×1 white texture: lets tiles/rects draw as plain tinted quads.
    const white = this.device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage: TEXTURE_USAGE.TEXTURE_BINDING | TEXTURE_USAGE.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: white },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4, rowsPerImage: 1 },
      [1, 1],
    );
    this.registerBindGroup('white', white, 1, 1, /* ownTexture */ true);
  }

  private createInstanceBuffer(spriteCount: number): GPUBuffer {
    return this.device.createBuffer({
      size: spriteCount * INSTANCE_STRIDE_BYTES,
      usage: BUFFER_USAGE.VERTEX | BUFFER_USAGE.COPY_DST,
    });
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
      layout: this.pipeline.getBindGroupLayout(1),
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

  // ------------------------------------------------------------- frame flow

  /** Begin a frame; clears to `clear` and prepares the sprite pipeline. */
  public beginFrame(clear: Rgba = [0.02, 0.01, 0.07, 1]): void {
    if (!this.context) throw new WebGPURendererError('beginFrame called before init().');

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: clear[0], g: clear[1], b: clear[2], a: clear[3] },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.pipeline);
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

  private uniformBindGroupCache: GPUBindGroup | null = null;
  private makeUniformBindGroup(): GPUBindGroup {
    if (!this.uniformBindGroupCache) {
      this.uniformBindGroupCache = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
      });
    }
    return this.uniformBindGroupCache;
  }

  /**
   * Queue sprites drawn with `textureName` (registered via createTextureFromCanvas
   * or the built-in 'white'). Actual GPU draws are batched per texture in endFrame.
   */
  public drawSprites(textureName: string, sprites: readonly SpriteDraw[]): void {
    if (!this.renderPass) throw new WebGPURendererError('drawSprites called outside begin/endFrame.');
    if (sprites.length === 0) return;
    const queue = this.queuedSprites.get(textureName);
    if (queue) queue.push(...sprites);
    else this.queuedSprites.set(textureName, [...sprites]);
  }

  /** Flush all queued sprite batches, submit, and present. */
  public endFrame(): void {
    const pass = this.renderPass;
    const encoder = this.commandEncoder;
    if (!pass || !encoder) throw new WebGPURendererError('endFrame called without beginFrame.');

    for (const [textureName, sprites] of this.queuedSprites) {
      const entry = this.textures.get(textureName);
      if (!entry) {
        console.warn(`[renderer] unknown texture "${textureName}" — skipping ${sprites.length} sprites`);
        continue;
      }

      // Grow the instance buffer if this batch outgrew our staging area.
      if (sprites.length > this.instanceCapacitySprites) {
        this.instanceCapacitySprites = Math.max(sprites.length, this.instanceCapacitySprites * 2);
        this.instanceBuffer.destroy();
        this.instanceBuffer = this.createInstanceBuffer(this.instanceCapacitySprites);
        this.instanceStaging = new Float32Array(
          this.instanceCapacitySprites * INSTANCE_FLOATS_PER_SPRITE,
        );
      }

      let f = 0;
      for (const s of sprites) {
        const tint = s.tint ?? [1, 1, 1, 1];
        this.instanceStaging[f++] = s.x;
        this.instanceStaging[f++] = s.y;
        this.instanceStaging[f++] = s.width;
        this.instanceStaging[f++] = s.height;
        this.instanceStaging[f++] = s.u0 ?? 0;
        this.instanceStaging[f++] = s.v0 ?? 0;
        this.instanceStaging[f++] = s.u1 ?? 1;
        this.instanceStaging[f++] = s.v1 ?? 1;
        this.instanceStaging[f++] = tint[0];
        this.instanceStaging[f++] = tint[1];
        this.instanceStaging[f++] = tint[2];
        this.instanceStaging[f++] = tint[3];
      }

      this.device.queue.writeBuffer(
        this.instanceBuffer,
        0,
        this.instanceStaging.buffer,
        0,
        sprites.length * INSTANCE_STRIDE_BYTES,
      );

      pass.setBindGroup(1, entry.bindGroup);
      pass.setVertexBuffer(1, this.instanceBuffer);
      pass.draw(QUAD_CORNERS.length / 2, sprites.length); // 6 verts × N instances
    }
    this.queuedSprites.clear();

    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this.renderPass = null;
    this.commandEncoder = null;
  }

  // ----------------------------------------------------------- texture mgmt

  /**
   * Upload an offscreen/DOM canvas (e.g. a procedurally generated parallax
   * layer) as a named GPU texture usable by the sprite pipeline.
   */
  public createTextureFromCanvas(name: string, source: OffscreenCanvas | HTMLCanvasElement): void {
    const width = source.width;
    const height = source.height;
    const texture = this.device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
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
