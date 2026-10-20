import { buildReshapedPatchBins } from '../../src/features/reshaped/patchSampling.mjs';
import type { DecodedIdRaster } from '../../src/features/reshaped/labelSampling.mjs';
import type { ReshapedPatchAtlas } from '../../src/features/reshaped/reshapedData';
import type { CDPSession, Page } from '@playwright/test';
import type { InverseField } from '../../src/features/reshaped/inverseFormat.mjs';

/** Upload once per field; morph stages share the same shader and GPU inputs. */
export async function readGpuInverseStages(
  page: Page,
  field: InverseField,
  source: string,
  queries: number[][],
  stages: number[],
  from: InverseField | null = null,
  paddingBits: { from: number; to: number } = { from: 0, to: 1 },
): Promise<number[][]> {
  const binary = (values: ArrayBufferView) =>
    Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString(
      'base64',
    );
  return page.evaluate(
    ({ field, from, source, queries, stages, paddingBits }) => {
      const decode = (value: string) => {
        const text = atob(value);
        const bytes = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
        return bytes.buffer;
      };
      const width = 256,
        height = Math.ceil(queries.length / width);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const gl = canvas.getContext('webgl2');
      if (!gl || !gl.getExtension('EXT_color_buffer_float'))
        throw new Error('WebGL2 float readback unavailable');
      const textures: WebGLTexture[] = [];
      const texture = (
        unit: number,
        width: number,
        height: number,
        internal: number,
        format: number,
        type: number,
        data: ArrayBufferView | null,
      ) => {
        const value = gl.createTexture()!;
        textures.push(value);
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, value);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          internal,
          width,
          height,
          0,
          format,
          type,
          data,
        );
        return value;
      };
      texture(
        0,
        field.width + 1,
        field.height + 1,
        gl.RG32F,
        gl.RG,
        gl.FLOAT,
        new Float32Array(decode(field.data)),
      );
      if (from)
        texture(
          1,
          from.width + 1,
          from.height + 1,
          gl.RG32F,
          gl.RG,
          gl.FLOAT,
          new Float32Array(decode(from.data)),
        );
      const inputs = new Float32Array(width * height * 4);
      queries.forEach((query, i) =>
        inputs.set(
          [
            query[0]!,
            query[1]!,
            query[2] ?? 0,
            Math.sin((query[1]! * Math.PI) / 180),
          ],
          i * 4,
        ),
      );
      texture(2, width, height, gl.RGBA32F, gl.RGBA, gl.FLOAT, inputs);
      const output = texture(
        3,
        width,
        height,
        gl.RGBA32F,
        gl.RGBA,
        gl.FLOAT,
        null,
      );
      const framebuffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        output,
        0,
      );
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('Incomplete float sampler framebuffer');
      const shader = (type: number, code: string) => {
        const value = gl.createShader(type)!;
        gl.shaderSource(value, code);
        gl.compileShader(value);
        if (!gl.getShaderParameter(value, gl.COMPILE_STATUS))
          throw new Error(
            gl.getShaderInfoLog(value) ?? 'Shader compilation failed',
          );
        return value;
      };
      const vertex = shader(
        gl.VERTEX_SHADER,
        `#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2)); gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`,
      );
      const fragment = shader(
        gl.FRAGMENT_SHADER,
        `#version 300 es
precision highp float; precision highp int;
precision highp sampler2D;
uniform sampler2D uFromField; uniform sampler2D uToField; uniform sampler2D uQueries; uniform float uT; uniform int uHasFrom;
uniform int uFromPaddingBit; uniform int uToPaddingBit;
layout(location=0) out vec4 result;
${source}
void main(){
  vec4 q=texelFetch(uQueries,ivec2(gl_FragCoord.xy),0);
  // Production receives the sphere's CPU-generated sine latitude in vGeo.y.
  float s=q.w;
  result=vec4(inverseMapping(uFromField,uToField,uHasFrom,1,q.x,q.y,s,uT),paddingWeight(int(q.z),uFromPaddingBit,uToPaddingBit,uT),1.0);
}`,
      );
      const program = gl.createProgram()!;
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(
          gl.getProgramInfoLog(program) ?? 'Sampler program linking failed',
        );
      gl.useProgram(program);
      for (const [name, unit] of [
        ['uToField', 0],
        ['uFromField', from ? 1 : 0],
        ['uQueries', 2],
      ] as const)
        gl.uniform1i(gl.getUniformLocation(program, name), unit);
      gl.uniform1i(gl.getUniformLocation(program, 'uHasFrom'), from ? 1 : 0);
      gl.uniform1i(
        gl.getUniformLocation(program, 'uFromPaddingBit'),
        paddingBits.from,
      );
      gl.uniform1i(
        gl.getUniformLocation(program, 'uToPaddingBit'),
        paddingBits.to,
      );
      gl.viewport(0, 0, width, height);
      const results: number[][] = [];
      for (const t of stages) {
        gl.uniform1f(gl.getUniformLocation(program, 'uT'), t);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const values = new Float32Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, values);
        results.push(Array.from(values.subarray(0, queries.length * 4)));
      }
      const error = gl.getError();
      for (const value of textures) gl.deleteTexture(value);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      if (error !== gl.NO_ERROR)
        throw new Error(`WebGL sampler error ${error}`);
      return results;
    },
    {
      field: {
        width: field.width,
        height: field.height,
        data: binary(field.data),
      },
      from: from
        ? { width: from.width, height: from.height, data: binary(from.data) }
        : null,
      source,
      queries,
      stages,
      paddingBits,
    },
  );
}

/** Upload the production RG8/R8 inputs and read the unmodified GLSL classifier. */
export async function readGpuLabels(
  page: Page,
  raster: DecodedIdRaster,
  source: string,
  queries: number[][],
  patchAtlas?: ReshapedPatchAtlas,
): Promise<number[]> {
  if (!raster.distance) throw new Error('GPU label test requires distances');
  const packed = new Uint8Array(raster.ids.length * 2);
  for (let i = 0; i < raster.ids.length; i += 1) {
    packed[i * 2] = raster.ids[i]!;
    packed[i * 2 + 1] = raster.padding?.[i] ?? 0;
  }
  const binary = (bytes: Uint8Array) =>
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
      'base64',
    );
  const patchBytes = patchAtlas
    ? new Uint8Array(patchAtlas.raster.ids.length * 3)
    : null;
  if (patchAtlas && patchBytes)
    for (let i = 0; i < patchAtlas.raster.ids.length; i++) {
      patchBytes[i * 3] = patchAtlas.raster.ids[i]!;
      patchBytes[i * 3 + 1] = patchAtlas.raster.padding?.[i] ?? 0;
      patchBytes[i * 3 + 2] = patchAtlas.raster.distance?.[i] ?? 0;
    }
  return page.evaluate(
    ({
      width,
      height,
      packed,
      distance,
      distanceCap,
      source,
      queries,
      patches,
    }) => {
      const decode = (encoded: string) => {
        const text = atob(encoded);
        return Uint8Array.from(text, (character) => character.charCodeAt(0));
      };
      const outputWidth = 256;
      const outputHeight = Math.ceil(queries.length / outputWidth);
      const canvas = document.createElement('canvas');
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const gl = canvas.getContext('webgl2');
      if (!gl || !gl.getExtension('EXT_color_buffer_float'))
        throw new Error('WebGL2 float label readback unavailable');
      const textures: WebGLTexture[] = [];
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const texture = (
        unit: number,
        width: number,
        height: number,
        internal: number,
        format: number,
        type: number,
        data: ArrayBufferView | null,
      ) => {
        const value = gl.createTexture()!;
        textures.push(value);
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, value);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          internal,
          width,
          height,
          0,
          format,
          type,
          data,
        );
        return value;
      };
      texture(
        0,
        width,
        height,
        gl.RG8,
        gl.RG,
        gl.UNSIGNED_BYTE,
        decode(packed),
      );
      texture(
        1,
        width,
        height,
        gl.R8,
        gl.RED,
        gl.UNSIGNED_BYTE,
        decode(distance),
      );
      if (patches)
        texture(
          4,
          patches.width,
          patches.height,
          gl.RGB8,
          gl.RGB,
          gl.UNSIGNED_BYTE,
          decode(patches.bytes),
        );
      const queryData = new Float32Array(outputWidth * outputHeight * 4);
      queries.forEach((query, i) =>
        queryData.set([query[0]!, query[1]!, 0, 0], i * 4),
      );
      texture(
        2,
        outputWidth,
        outputHeight,
        gl.RGBA32F,
        gl.RGBA,
        gl.FLOAT,
        queryData,
      );
      const output = texture(
        3,
        outputWidth,
        outputHeight,
        gl.RGBA32F,
        gl.RGBA,
        gl.FLOAT,
        null,
      );
      const framebuffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        output,
        0,
      );
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('Incomplete label sampler framebuffer');
      const shader = (type: number, code: string) => {
        const value = gl.createShader(type)!;
        gl.shaderSource(value, code);
        gl.compileShader(value);
        if (!gl.getShaderParameter(value, gl.COMPILE_STATUS))
          throw new Error(
            gl.getShaderInfoLog(value) ?? 'Label shader compilation failed',
          );
        return value;
      };
      const vertex = shader(
        gl.VERTEX_SHADER,
        `#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`,
      );
      const fragment = shader(
        gl.FRAGMENT_SHADER,
        `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uIds; uniform sampler2D uDistances; uniform sampler2D uQueries;
layout(location=0) out vec4 result;
${source}
void main(){vec2 uv=texelFetch(uQueries,ivec2(gl_FragCoord.xy),0).xy;
${
  patches
    ? `vec2 local; float weight; int index=patchAt(uv,local,weight);
result=index>=0 && weight>=0.5 ? classifyPatch(local,uPatchRects[index]) : classify(uv); result.w=weight;`
    : 'result=classify(uv);'
}
}`,
      );
      const program = gl.createProgram()!;
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(
          gl.getProgramInfoLog(program) ?? 'Label shader linking failed',
        );
      gl.useProgram(program);
      for (const [name, unit] of [
        ['uIds', 0],
        ['uDistances', 1],
        ['uQueries', 2],
      ] as const)
        gl.uniform1i(gl.getUniformLocation(program, name), unit);
      gl.uniform1f(gl.getUniformLocation(program, 'uDistanceCap'), distanceCap);
      if (patches) {
        gl.uniform2uiv(
          gl.getUniformLocation(program, 'uPatchBins[0]'),
          new Uint32Array(patches.bins),
        );
        gl.uniform1i(gl.getUniformLocation(program, 'uPatchAtlas'), 4);
        gl.uniform1i(
          gl.getUniformLocation(program, 'uPatchCount'),
          patches.entries.length,
        );
        const boxes = new Float32Array(64 * 4),
          rects = new Float32Array(64 * 4);
        patches.entries.forEach((patch, i) => {
          boxes.set(patch.bbox, i * 4);
          rects.set(
            [
              patch.atlas.x,
              patch.atlas.y,
              patch.atlas.width,
              patch.atlas.height,
            ],
            i * 4,
          );
        });
        gl.uniform4fv(gl.getUniformLocation(program, 'uPatchBboxes[0]'), boxes);
        gl.uniform4fv(gl.getUniformLocation(program, 'uPatchRects[0]'), rects);
      }
      gl.viewport(0, 0, outputWidth, outputHeight);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const values = new Float32Array(outputWidth * outputHeight * 4);
      gl.readPixels(0, 0, outputWidth, outputHeight, gl.RGBA, gl.FLOAT, values);
      const error = gl.getError();
      for (const texture of textures) gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      if (error !== gl.NO_ERROR)
        throw new Error(`WebGL label sampler error ${error}`);
      return Array.from(values.subarray(0, queries.length * 4));
    },
    {
      width: raster.width,
      height: raster.height,
      packed: binary(packed),
      distance: binary(raster.distance),
      distanceCap: raster.distanceCap ?? 255,
      source,
      queries,
      patches:
        patchAtlas && patchBytes
          ? {
              width: patchAtlas.width,
              height: patchAtlas.height,
              entries: patchAtlas.patches.map(({ bbox, atlas }) => ({
                bbox,
                atlas,
              })),
              bins: Array.from(buildReshapedPatchBins(patchAtlas)),
              bytes: binary(patchBytes),
            }
          : null,
    },
  );
}

export interface BrowserResourceCounts {
  renderersCreated: number;
  renderersAlive: number;
  textures: number;
  geometries: number;
  programs: number;
  contextsCreated: number;
  contextsAlive: number;
  contextCanvasesConnected: number;
  workersCreated: number;
  workersTerminated: number;
  workersCloseRequested: number;
  workerUrls: string[];
  timeouts: number;
  intervals: number;
  animationFrames: number;
}

export interface ReshapedResourceSample extends BrowserResourceCounts {
  label: string;
  heapUsedBytes: number;
  heapTotalBytes: number;
  backingStorageBytes: number;
  arrayBuffers: number;
  arrayBufferBytes: number;
  imageBitmaps: number;
  imageBitmapEstimatedBytes: number;
  workersAlive: number;
  cdpWorkersAlive: number;
  documents: number;
  nodes: number;
  eventListeners: number;
}

export async function installReshapedResourceProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Renderer = {
      isWebGLRenderer: boolean;
      info: {
        memory: { textures: number; geometries: number };
        programs: unknown[] | null;
      };
    };
    const renderers: WeakRef<Renderer>[] = [];
    const contexts: WeakRef<WebGLRenderingContext | WebGL2RenderingContext>[] =
      [];
    const knownContexts = new WeakSet<
      WebGLRenderingContext | WebGL2RenderingContext
    >();
    const workerUrls = new Set<string>();
    let workersCreated = 0;
    let workersTerminated = 0;
    let workersCloseRequested = 0;
    const terminated = new WeakSet<Worker>();
    const closeRequested = new WeakSet<Worker>();
    const timeouts = new Set<number>();
    const intervals = new Set<number>();
    const animationFrames = new Set<number>();

    // Three already emits this event at renderer construction. WeakRef prevents
    // the test probe from keeping a detached renderer or its resources alive.
    const devtools = new EventTarget();
    devtools.addEventListener('observe', (event) => {
      const renderer = (event as CustomEvent<Renderer>).detail;
      if (renderer?.isWebGLRenderer) renderers.push(new WeakRef(renderer));
    });
    Object.defineProperty(window, '__THREE_DEVTOOLS__', { value: devtools });

    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args
    ) {
      const context = getContext.apply(this, args);
      if (
        (args[0] === 'webgl' ||
          args[0] === 'webgl2' ||
          args[0] === 'experimental-webgl') &&
        context &&
        !knownContexts.has(context as WebGLRenderingContext)
      ) {
        knownContexts.add(context as WebGLRenderingContext);
        contexts.push(new WeakRef(context as WebGLRenderingContext));
      }
      return context;
    } as typeof getContext;

    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args, newTarget) {
        const worker = Reflect.construct(target, args, newTarget) as Worker;
        workersCreated += 1;
        workerUrls.add(String(args[0]));
        return worker;
      },
    });
    const terminate = NativeWorker.prototype.terminate;
    NativeWorker.prototype.terminate = function () {
      if (!terminated.has(this)) {
        terminated.add(this);
        workersTerminated += 1;
      }
      terminate.call(this);
    };
    const postMessage = NativeWorker.prototype.postMessage;
    NativeWorker.prototype.postMessage = function (this: Worker, ...args) {
      // Meshopt's useWorkers(0) sends {} and the worker calls self.close().
      // This only records the request; CDP/Page worker counts prove it exited.
      const message = args[0] as unknown;
      if (
        message &&
        typeof message === 'object' &&
        Object.keys(message).length === 0 &&
        !closeRequested.has(this)
      ) {
        closeRequested.add(this);
        workersCloseRequested += 1;
      }
      return Reflect.apply(postMessage, this, args);
    } as typeof postMessage;

    const setTimeoutNative = window.setTimeout.bind(window);
    const clearTimeoutNative = window.clearTimeout.bind(window);
    window.setTimeout = ((
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      // No application timer uses string handlers; preserve their native path.
      if (typeof handler !== 'function')
        return setTimeoutNative(handler, delay, ...args);
      let id = 0;
      id = setTimeoutNative(() => {
        timeouts.delete(id);
        Reflect.apply(handler, window, args);
      }, delay);
      timeouts.add(id);
      return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = (id) => {
      if (typeof id === 'number') {
        timeouts.delete(id);
        intervals.delete(id);
      }
      clearTimeoutNative(id);
    };
    const setIntervalNative = window.setInterval.bind(window);
    const clearIntervalNative = window.clearInterval.bind(window);
    window.setInterval = ((
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      const id = setIntervalNative(handler, delay, ...args);
      intervals.add(id);
      return id;
    }) as typeof window.setInterval;
    window.clearInterval = (id) => {
      if (typeof id === 'number') {
        timeouts.delete(id);
        intervals.delete(id);
      }
      clearIntervalNative(id);
    };
    const requestFrame = window.requestAnimationFrame.bind(window);
    const cancelFrame = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      let id = 0;
      id = requestFrame((time) => {
        animationFrames.delete(id);
        Reflect.apply(callback, window, [time]);
      });
      animationFrames.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      animationFrames.delete(id);
      cancelFrame(id);
    };

    const probe = {
      snapshot(): BrowserResourceCounts {
        const liveRenderers = renderers
          .map((ref) => ref.deref())
          .filter((value): value is Renderer => Boolean(value));
        const liveContexts = contexts
          .map((ref) => ref.deref())
          .filter(
            (value): value is WebGLRenderingContext =>
              Boolean(value) && !value!.isContextLost(),
          );
        return {
          renderersCreated: renderers.length,
          renderersAlive: liveRenderers.length,
          textures: liveRenderers.reduce(
            (sum, renderer) => sum + renderer.info.memory.textures,
            0,
          ),
          geometries: liveRenderers.reduce(
            (sum, renderer) => sum + renderer.info.memory.geometries,
            0,
          ),
          programs: liveRenderers.reduce(
            (sum, renderer) => sum + (renderer.info.programs?.length ?? 0),
            0,
          ),
          contextsCreated: contexts.length,
          contextsAlive: liveContexts.length,
          contextCanvasesConnected: liveContexts.filter(
            (context) =>
              context.canvas instanceof HTMLCanvasElement &&
              context.canvas.isConnected,
          ).length,
          workersCreated,
          workersTerminated,
          workersCloseRequested,
          workerUrls: [...workerUrls],
          timeouts: timeouts.size,
          intervals: intervals.size,
          animationFrames: animationFrames.size,
        };
      },
    };
    Object.defineProperty(window, '__reshapedResourceProbe', { value: probe });
  });
}

/** queryObjects temporarily roots its result. Always release it before measuring heap. */
async function queryNativeObjects(
  session: CDPSession,
  constructor: 'ArrayBuffer' | 'ImageBitmap',
) {
  const objectGroup = `reshaped-resource-${constructor}`;
  try {
    const prototype = await session.send('Runtime.evaluate', {
      expression: `${constructor}.prototype`,
      objectGroup,
    });
    if (!prototype.result.objectId)
      throw new Error(`No ${constructor} prototype`);
    const objects = await session.send('Runtime.queryObjects', {
      prototypeObjectId: prototype.result.objectId,
      objectGroup,
    });
    if (!objects.objects.objectId)
      throw new Error(`Cannot enumerate ${constructor}`);
    const result = await session.send('Runtime.callFunctionOn', {
      objectId: objects.objects.objectId,
      functionDeclaration:
        constructor === 'ArrayBuffer'
          ? 'function(){return {count:this.length,bytes:this.reduce((sum,value)=>sum+value.byteLength,0)}}'
          : 'function(){return this.reduce((sum,value)=>({count:sum.count+(value.width>0&&value.height>0?1:0),bytes:sum.bytes+value.width*value.height*4}),{count:0,bytes:0})}',
      returnByValue: true,
      objectGroup,
    });
    if (result.exceptionDetails)
      throw new Error(`Cannot read ${constructor} objects`);
    return result.result.value as { count: number; bytes: number };
  } finally {
    await session.send('Runtime.releaseObjectGroup', { objectGroup });
  }
}

/** Both configured browser projects are Chromium; callers must sample serially. */
export async function createReshapedResourceSampler(page: Page) {
  const session = await page.context().newCDPSession(page);
  await session.send('HeapProfiler.enable');
  return {
    async sample(label: string): Promise<ReshapedResourceSample> {
      // WeakRef dereferences are performed only after GC and never saved by the
      // test. Probe entries retain a few strings/numbers, never app objects.
      await session.send('HeapProfiler.collectGarbage');
      const arrayBuffers = await queryNativeObjects(session, 'ArrayBuffer');
      const imageBitmaps = await queryNativeObjects(session, 'ImageBitmap');
      await session.send('HeapProfiler.collectGarbage');
      const usage = await session.send('Runtime.getHeapUsage');
      if (usage.backingStorageSize === undefined)
        throw new Error('CDP did not expose backing storage size');
      const dom = await session.send('Memory.getDOMCounters');
      const browserCounts = await page.evaluate(() => {
        const probe = (
          window as typeof window & {
            __reshapedResourceProbe: { snapshot(): BrowserResourceCounts };
          }
        ).__reshapedResourceProbe;
        if (!probe)
          throw new Error('Reshaped resource probe was not installed');
        return probe.snapshot();
      });
      const targets = await session.send('Target.getTargets');
      const workerUrls = new Set(browserCounts.workerUrls);
      return {
        ...browserCounts,
        label,
        heapUsedBytes: usage.usedSize,
        heapTotalBytes: usage.totalSize,
        backingStorageBytes: usage.backingStorageSize,
        arrayBuffers: arrayBuffers.count,
        arrayBufferBytes: arrayBuffers.bytes,
        imageBitmaps: imageBitmaps.count,
        imageBitmapEstimatedBytes: imageBitmaps.bytes,
        workersAlive: page.workers().length,
        cdpWorkersAlive: targets.targetInfos.filter(
          (target) => target.type === 'worker' && workerUrls.has(target.url),
        ).length,
        documents: dom.documents,
        nodes: dom.nodes,
        eventListeners: dom.jsEventListeners,
      };
    },
    async dispose() {
      await session.send('HeapProfiler.disable');
      await session.detach();
    },
  };
}
