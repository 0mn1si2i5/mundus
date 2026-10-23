import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { globeRegion } from './helpers';
import { RESHAPED_DETAIL_CASES } from './reshaped-clarity-cases';

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
      uniform float stretch; uniform float angle;
      void main(){
        vec2 dx=vec2(stretch*cos(angle),0.25*sin(angle))/32.0/uPixelRatio;
        vec2 dy=vec2(-stretch*sin(angle),0.25*cos(angle))/32.0/uPixelRatio;
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
    for (const texture of textures) gl.deleteTexture(texture);
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return output;
  }, source);
  await testInfo.attach('edge-widths', {
    body: JSON.stringify(widths, null, 2),
    contentType: 'application/json',
  });
  for (const row of widths)
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
