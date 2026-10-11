import { buildReshapedPatchBins } from '../../src/features/reshaped/patchSampling.mjs';
import type { Page } from '@playwright/test';
import type { DecodedIdRaster } from '../../src/features/reshaped/labelSampling.mjs';
import type { ReshapedPatchAtlas } from '../../src/features/reshaped/reshapedData';

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
