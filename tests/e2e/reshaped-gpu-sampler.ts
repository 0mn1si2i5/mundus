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
): Promise<number[][]> {
  const binary = (values: ArrayBufferView) =>
    Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString(
      'base64',
    );
  return page.evaluate(
    ({ field, source, queries, stages }) => {
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
      const adaptive = field.encoding === 'adaptive-quadtree-int16';
      const treeWidth = adaptive ? 1024 : 1;
      const sourceTree = field.tree
        ? new Uint32Array(decode(field.tree))
        : new Uint32Array([0x80000000]);
      const sourceCorners = field.corners
        ? new Int16Array(decode(field.corners))
        : new Int16Array(8);
      const treeHeight = Math.ceil(sourceTree.length / treeWidth);
      const tree = new Uint32Array(treeWidth * treeHeight);
      tree.set(sourceTree);
      const cornerHeight = Math.ceil(sourceCorners.length / (treeWidth * 4));
      const corners = new Int16Array(treeWidth * cornerHeight * 4);
      corners.set(sourceCorners);
      texture(
        0,
        adaptive ? 1 : field.width,
        adaptive ? 1 : field.height,
        gl.RG32F,
        gl.RG,
        gl.FLOAT,
        field.data ? new Float32Array(decode(field.data)) : new Float32Array(2),
      );
      texture(
        1,
        treeWidth,
        treeHeight,
        gl.R32UI,
        gl.RED_INTEGER,
        gl.UNSIGNED_INT,
        tree,
      );
      texture(
        2,
        treeWidth,
        cornerHeight,
        gl.RGBA16I,
        gl.RGBA_INTEGER,
        gl.SHORT,
        corners,
      );
      const inputs = new Float32Array(width * height * 2);
      queries.forEach((query, i) => inputs.set(query, i * 2));
      texture(3, width, height, gl.RG32F, gl.RG, gl.FLOAT, inputs);
      const output = texture(
        4,
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
precision highp sampler2D; precision highp usampler2D; precision highp isampler2D;
uniform sampler2D uField; uniform usampler2D uTree; uniform isampler2D uCorners;
uniform sampler2D uQueries; uniform ivec2 uRoot; uniform vec2 uSteps;
uniform bool uAdaptive; uniform bool uLatitude; uniform float uT;
layout(location=0) out vec4 result;
${source}
void main(){
  vec2 q=texelFetch(uQueries,ivec2(gl_FragCoord.xy),0).rg;
  float s=sin(radians(q.y));
  vec2 d=uAdaptive?adaptiveDisplacement(uTree,uCorners,uRoot,uSteps,q.x,s,q.y,uLatitude):displacement(uField,q.x,s);
  float latitude=uLatitude?clamp(q.y+d.y,-90.0,90.0):degrees(asin(clamp(s+d.y,-1.0,1.0)));
  result=vec4(wrapLongitude(q.x+d.x*uT),morphLatitude(q.y,latitude,uT),0.0,1.0);
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
        ['uField', 0],
        ['uTree', 1],
        ['uCorners', 2],
        ['uQueries', 3],
      ] as const)
        gl.uniform1i(gl.getUniformLocation(program, name), unit);
      gl.uniform2i(
        gl.getUniformLocation(program, 'uRoot'),
        field.width,
        field.height,
      );
      gl.uniform2f(
        gl.getUniformLocation(program, 'uSteps'),
        field.header?.stepLongitude ?? 1,
        field.header?.stepLatitude ?? field.header?.stepS ?? 1,
      );
      gl.uniform1i(
        gl.getUniformLocation(program, 'uAdaptive'),
        Number(adaptive),
      );
      gl.uniform1i(
        gl.getUniformLocation(program, 'uLatitude'),
        Number(field.header?.verticalCoordinate === 'latitude'),
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
        encoding: field.encoding,
        header: field.header,
        data: field.data ? binary(field.data) : undefined,
        tree: field.tree ? binary(field.tree) : undefined,
        corners: field.corners ? binary(field.corners) : undefined,
      },
      source,
      queries,
      stages,
    },
  );
}
