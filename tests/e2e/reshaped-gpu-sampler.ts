import type { Page } from '@playwright/test';
import type { InverseField } from '../../src/features/reshaped/inverseFormat.mjs';

/** Compile the production sampler in a real WebGL2 context and read RGBA32F. */
export async function readGpuInverse(
  page: Page,
  field: InverseField,
  source: string,
  queries: number[][],
  t: number,
): Promise<number[]> {
  return (await readGpuInverseStages(page, field, source, queries, [t]))[0]!;
}

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
