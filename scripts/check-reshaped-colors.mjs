import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// The production tokens stay in the runtime metadata. TypeScript is already
// a build dependency; transpile in memory so this audit leaves no artifacts.
async function sourceModule(path, replace = (source) => source) {
  const source = replace(
    await readFile(new URL(path, import.meta.url), 'utf8'),
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  );
}

export async function checkReshapedColors() {
  const math = await sourceModule('../src/features/reshaped/colorMath.ts');
  const { RESHAPED_METRIC_THEMES: themes } = await sourceModule(
    '../src/features/reshaped/metrics.ts',
    (source) =>
      source
        .replace(
          /import \{ messages \} from '..\/..\/i18n\/messages';/u,
          'const messages={};',
        )
        .replace(
          /import \{ RESHAPED_PUBLISHED_METRIC_IDS \} from '.\/publishedMetrics';/u,
          "const RESHAPED_PUBLISHED_METRIC_IDS=['population','gdp','co2','lights'];",
        ),
  );
  return Object.fromEntries(
    Object.entries(themes).map(([metric, theme]) => {
      const colors = theme.palette.map(math.hexToRgb);
      const adjacent = Object.fromEntries(
        ['protan', 'deutan', 'tritan'].map((mode) => [
          mode,
          colors
            .slice(1)
            .map((color, i) =>
              math.deltaE2000(
                math.simulateColorBlind(colors[i], mode),
                math.simulateColorBlind(color, mode),
              ),
            ),
        ]),
      );
      const padding = colors.map((color, i) =>
        Math.min(
          ...[colors[i - 1], colors[i + 1]]
            .filter(Boolean)
            .map((neighbor) =>
              math.deltaE2000(math.desaturate(color), neighbor),
            ),
        ),
      );
      const borders = colors.map((color) =>
        Math.max(
          math.contrastRatio(math.hexToRgb('#000000'), color),
          math.contrastRatio(math.hexToRgb('#ffffff'), color),
        ),
      );
      return [
        metric,
        {
          palette: theme.palette,
          adjacent,
          padding,
          borders,
          luminance: colors.map(math.relativeLuminance),
          oceanContrast: math.contrastRatio(
            colors[0],
            math.hexToRgb(theme.ocean),
          ),
          litOceanContrast: [
            theme.light.ambient,
            theme.light.ambient + theme.light.directional,
          ].map((factor) =>
            math.contrastRatio(
              math.applyLinearLight(colors[0], factor),
              math.applyLinearLight(math.hexToRgb(theme.ocean), factor),
            ),
          ),
          litBorderMinimum: [
            theme.light.ambient,
            theme.light.ambient + theme.light.directional,
          ].map((factor) =>
            Math.min(
              ...colors.map((color) =>
                math.contrastRatio(
                  math.applyLinearLight(
                    math.hexToRgb(
                      math.relativeLuminance(color) < 0.179
                        ? theme.borderLight
                        : theme.border,
                    ),
                    factor,
                  ),
                  math.applyLinearLight(color, factor),
                ),
              ),
            ),
          ),
        },
      ];
    }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await checkReshapedColors(), null, 2));
