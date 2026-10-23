import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { globeRegion } from './helpers';
import { RESHAPED_DETAIL_CASES } from './reshaped-clarity-cases';
import { decodePngRgb } from '../../src/features/reshaped/pngCore.mjs';
import {
  sampleReshapedLabel,
  type DecodedIdRaster,
} from '../../src/features/reshaped/labelSampling.mjs';
import { sampleReshapedPatchLabel } from '../../src/features/reshaped/patchSampling.mjs';
import type { ReshapedPatchAtlas } from '../../src/features/reshaped/reshapedData';
import { readGpuLabels } from './reshaped-gpu-harness';

// Compile the production shading path against a straight horizontal border.
// Stretching along that border must not widen it in the perpendicular direction.
test('country ink keeps its screen width under tangential cartogram stretching', async ({
  page,
}, testInfo) => {
  const file = await readFile('src/features/globe/ReshapedLayer.tsx', 'utf8');
  const block = (name: string) => {
    const value = file.match(
      new RegExp(`export const ${name} = \x60([\\s\\S]*?)\x60;`, 'u'),
    )?.[1];
    if (!value) throw new Error(`Missing production shader ${name}`);
    return value;
  };
  let source = block('RESHAPED_FRAGMENT_SHADER');
  for (const name of [
    'RESHAPED_SAMPLING_GLSL',
    'RESHAPED_LABEL_GLSL',
    'RESHAPED_PATCH_GLSL',
  ]) {
    source = source.replace('${' + name + '}', block(name));
  }
  source = source
    .replace('${360 / 4096.0}', String(360 / 4096))
    .replace('${180 / 2048.0}', String(180 / 2048));
  source = source.slice(0, source.lastIndexOf('void main()'));
  await page.goto('about:blank');
  const widths = await page.evaluate((source) => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 128;
    const gl = canvas.getContext('webgl2', { antialias: false })!;
    if (!gl) throw new Error('WebGL2 unavailable');
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader)!);
      return shader;
    };
    const vertex = compile(
      gl.VERTEX_SHADER,
      `#version 300 es
      void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`,
    );
    const fragment = compile(
      gl.FRAGMENT_SHADER,
      `#version 300 es
      precision highp float; precision highp int;
      ${source}
      uniform float stretch; uniform float angle; uniform float normalScale;
      void main(){
        vec2 dx=vec2(stretch*cos(angle),normalScale*sin(angle))/32.0/uPixelRatio;
        vec2 dy=vec2(-stretch*sin(angle),normalScale*cos(angle))/32.0/uPixelRatio;
        vec2 uv=vec2(0.5,0.5)+(gl_FragCoord.x-32.0)*dx+(gl_FragCoord.y-64.0)*dy;
        gl_FragColor=vec4(shadeAt(uv,vec3(0.0),dx,dy,abs(dx)+abs(dy),0.01).rgb,1.0);
      }`,
    );
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program)!);
    gl.useProgram(program);
    const textures: WebGLTexture[] = [];
    const texture = (
      name: string,
      unit: number,
      width: number,
      height: number,
      format: number,
      internal: number,
      data: Uint8Array,
    ) => {
      const texture = gl.createTexture()!;
      textures.push(texture);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        internal,
        width,
        height,
        0,
        format,
        gl.UNSIGNED_BYTE,
        data,
      );
      gl.uniform1i(gl.getUniformLocation(program, name), unit);
    };
    const ids = new Uint8Array(32 * 32 * 2),
      distances = new Uint8Array(32 * 32);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const i = y * 32 + x;
        ids[i * 2] = y < 16 ? 1 : 2;
        distances[i] = Math.round(
          (Math.min(4, Math.abs(y + 0.5 - 16)) * 255) / 4,
        );
      }
    texture('uIds', 0, 32, 32, gl.RG, gl.RG8, ids);
    texture('uDistances', 1, 32, 32, gl.RED, gl.R8, distances);
    texture(
      'uPalette',
      2,
      3,
      4,
      gl.RGB,
      gl.RGB8,
      new Uint8Array(3 * 4 * 3).fill(255),
    );
    gl.uniform1f(gl.getUniformLocation(program, 'uDistanceCap'), 255);
    gl.uniform3f(gl.getUniformLocation(program, 'uOcean'), 1, 1, 1);
    const atlas = new Uint8Array(34 * 34 * 3);
    for (let y = 0; y < 34; y++)
      for (let x = 0; x < 34; x++) {
        const i =
          Math.max(0, Math.min(31, y - 1)) * 32 +
          Math.max(0, Math.min(31, x - 1));
        atlas[(y * 34 + x) * 3] = ids[i * 2]!;
        atlas[(y * 34 + x) * 3 + 2] = distances[i]!;
      }
    texture('uPatchAtlas', 3, 34, 34, gl.RGB, gl.RGB8, atlas);
    gl.uniform4f(
      gl.getUniformLocation(program, 'uPatchBboxes[0]'),
      -180,
      -90,
      180,
      90,
    );
    gl.uniform4f(
      gl.getUniformLocation(program, 'uPatchRects[0]'),
      0,
      0,
      34,
      34,
    );
    const bins = new Uint32Array(64);
    for (let i = 0; i < 64; i += 2) bins[i] = 1;
    gl.uniform2uiv(gl.getUniformLocation(program, 'uPatchBins[0]'), bins);
    gl.uniform1f(gl.getUniformLocation(program, 'normalScale'), 0.25);
    const output = [];
    for (const patch of [0, 1])
      for (const angle of [0, Math.PI / 4])
        for (const dpr of [1, 2])
          for (const stretch of [0.25, 1, 4]) {
            gl.uniform1i(gl.getUniformLocation(program, 'uPatchCount'), patch);
            gl.uniform1f(gl.getUniformLocation(program, 'angle'), angle);
            gl.uniform1f(gl.getUniformLocation(program, 'uPixelRatio'), dpr);
            gl.uniform1f(gl.getUniformLocation(program, 'stretch'), stretch);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            const pixels = new Uint8Array(128 * 4);
            gl.readPixels(32, 0, 1, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            let ink = 0;
            for (let y = 0; y < 128; y++) ink += 1 - pixels[y * 4]! / 255;
            output.push({
              patch,
              angle,
              dpr,
              stretch,
              width: (ink / dpr) * Math.cos(angle),
            });
          }
    // A fine atlas viewed from far away saturates before the wide inner ring.
    // The boundary itself must still identify the selected country.
    gl.uniform1i(gl.getUniformLocation(program, 'uSelected'), 1);
    gl.uniform3f(gl.getUniformLocation(program, 'uSelection'), 1, 0, 1);
    gl.uniform1f(gl.getUniformLocation(program, 'normalScale'), 4);
    gl.uniform1f(gl.getUniformLocation(program, 'angle'), 0);
    gl.uniform1f(gl.getUniformLocation(program, 'uPixelRatio'), 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const selected = new Uint8Array(128 * 4);
    gl.readPixels(32, 0, 1, 128, gl.RGBA, gl.UNSIGNED_BYTE, selected);
    let emphasis = 0;
    for (let y = 0; y < 128; y++)
      emphasis += (selected[y * 4 + 2]! - selected[y * 4 + 1]!) / 255;
    for (const texture of textures) gl.deleteTexture(texture);
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { output, emphasis };
  }, source);
  await testInfo.attach('edge-widths', {
    body: JSON.stringify(widths.output, null, 2),
    contentType: 'application/json',
  });
  expect(
    widths.emphasis,
    'selected ink at a saturated local distance',
  ).toBeGreaterThan(0.1);
  for (const row of widths.output)
    expect(row.width, JSON.stringify(row)).toBeCloseTo(1, 0);
});

for (const detail of RESHAPED_DETAIL_CASES) {
  test(`${detail.id}: expanded detail preserves the restored country across shape changes`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(
      `./?v=2&mode=reshaped&metric=lights&point=${encodeURIComponent(detail.point)}`,
    );
    const globe = globeRegion(page);
    await expect(globe).toHaveAttribute('data-morph-state', 'settled');
    const result = page.getByTestId('reshaped-result');
    await expect(result).toContainText(detail.name);
    const controls = page.getByRole('region', { name: '变形地球控件' });
    const expand = controls.getByRole('button', { name: '展开变形地球控件' });
    if (await expand.isVisible()) await expand.click();
    await controls
      .getByRole('button', { name: '真实形状', exact: true })
      .click();
    await expect(globe).toHaveAttribute('data-morph-state', 'settled');
    await expect(result).toContainText(detail.name);
    await controls
      .getByRole('button', { name: '变形形状', exact: true })
      .click();
    await expect(globe).toHaveAttribute('data-morph-state', 'settled');
    await expect(result).toContainText(detail.name);
    await testInfo.attach('detail', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('published detail atlas agrees with CPU ownership along every transition band', async ({
  page,
}, testInfo) => {
  await page.goto('about:blank');
  const shader = await readFile('src/features/globe/ReshapedLayer.tsx', 'utf8');
  const label = shader.match(
    /export const RESHAPED_LABEL_GLSL = `([\s\S]*?)`;/u,
  )?.[1];
  const patch = shader
    .match(/export const RESHAPED_PATCH_GLSL = `([\s\S]*?)`;/u)?.[1]
    .replace('${360 / 4096.0}', String(360 / 4096))
    .replace('${180 / 2048.0}', String(180 / 2048));
  if (!label || !patch) throw new Error('Production classifier missing');
  const source = `${label}\nfloat wrapLongitude(float x){return mod(x+180.0,360.0)-180.0;}\n${patch}`;
  const decode = async (
    name: string,
    sample: 1 | 2,
  ): Promise<DecodedIdRaster> => {
    const bytes = await readFile(`src/data/generated/reshaped-earth/${name}`);
    const packed = await decodePngRgb(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      { sample },
    );
    const raster = {
      width: packed.width,
      height: packed.height,
      ids: new Uint32Array(packed.ids.length),
      padding: new Uint8Array(packed.ids.length),
      distance: new Uint8Array(packed.ids.length),
      distanceCap: Math.round(255 / sample),
    };
    for (let i = 0; i < packed.ids.length; i++) {
      raster.ids[i] = packed.ids[i]! >>> 16;
      raster.padding[i] = (packed.ids[i]! >>> 8) & 255;
      raster.distance[i] = Math.round((packed.ids[i]! & 255) / sample);
    }
    return raster;
  };
  const descriptor = JSON.parse(
    await readFile(
      'src/data/generated/reshaped-earth/ids-patches.json',
      'utf8',
    ),
  );
  const atlas: ReshapedPatchAtlas = {
    ...descriptor,
    raster: await decode('ids-patches.png', 1),
  };
  const queries: number[][] = [];
  for (const entry of atlas.patches) {
    const [w, s, e, n] = entry.bbox;
    // Both sides of the CPU/GPU half-weight switch, full atlas, and outside.
    for (const offset of [-0.1, 0.5, 0.99, 1, 1.01, 1.5, 2.1])
      for (const f of [0.15, 0.35, 0.5, 0.65, 0.85]) {
        const dx = (offset * 360) / 4096,
          dy = (offset * 180) / 2048;
        for (const [lon, lat] of [
          [w + dx, s + (n - s) * f],
          [e - dx, s + (n - s) * f],
          [w + (e - w) * f, s + dy],
          [w + (e - w) * f, n - dy],
        ])
          queries.push([
            Math.fround((lon! + 180) / 360),
            Math.fround((90 - lat!) / 180),
          ]);
      }
  }
  for (const sample of [1, 2] as const) {
    const base = await decode('ids-country.png', sample);
    const gpu = await readGpuLabels(page, base, source, queries, atlas);
    for (const [i, uv] of queries.entries()) {
      const longitude = uv[0]! * 360 - 180,
        latitude = 90 - uv[1]! * 180;
      const cpu =
        sampleReshapedPatchLabel(atlas, latitude, longitude) ??
        sampleReshapedLabel(base, latitude, longitude);
      expect(
        gpu[i * 4],
        `sample${sample} country ${longitude},${latitude}`,
      ).toBe(cpu.id);
      expect(
        gpu[i * 4 + 2],
        `sample${sample} padding ${longitude},${latitude}`,
      ).toBe(cpu.padding);
    }
  }
  await testInfo.attach('published-atlas-samples', {
    body: JSON.stringify({
      blocks: atlas.patches.length,
      queries: queries.length,
      qualities: 2,
    }),
    contentType: 'application/json',
  });
});
