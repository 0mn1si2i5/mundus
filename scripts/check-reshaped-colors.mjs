import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

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
  const result = Object.fromEntries(
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
      const ink = math.hexToRgb(theme.border);
      const borderContrast = colors.map((color) =>
        math.contrastRatio(ink, color),
      );
      const paddingColors = colors.map((color) => math.desaturate(color));
      const paddingContrast = paddingColors.map((color) =>
        math.contrastRatio(ink, color),
      );
      const luminance = colors.map(math.relativeLuminance);
      const selectionContrast = math.contrastRatio(
        ink,
        math.hexToRgb(theme.selection),
      );
      const oceanContrast =
        metric === 'lights'
          ? math.contrastRatio(colors[0], math.hexToRgb(theme.ocean))
          : null;
      return [
        metric,
        {
          palette: theme.palette,
          ink: theme.border,
          selection: theme.selection,
          adjacent,
          padding,
          borderContrast,
          paddingContrast,
          luminance,
          selectionContrast,
          oceanContrast,
        },
      ];
    }),
  );
  for (const [metric, report] of Object.entries(result)) {
    for (const mode of ['protan', 'deutan', 'tritan'])
      if (Math.min(...report.adjacent[mode]) < 10)
        throw new Error(`${metric} ${mode} adjacent ΔE00 below 10`);
    if (Math.min(...report.padding) < 10)
      throw new Error(`${metric} padding ΔE00 below 10`);
    if (Math.min(...report.borderContrast, ...report.paddingContrast) < 3)
      throw new Error(`${metric} border contrast below 3:1`);
    if (report.selectionContrast < 3)
      throw new Error(`${metric} selection contrast below 3:1`);
    const l = report.luminance;
    const monotonic =
      metric === 'lights'
        ? l.every((value, i) => i === 0 || value > l[i - 1])
        : l.slice(0, 4).every((value, i) => i === 0 || value > l[i - 1]) &&
          l
            .slice(4)
            .every((value, i, values) => i === 0 || value < values[i - 1]);
    if (!monotonic)
      throw new Error(`${metric} luminance order is not monotonic`);
    if (metric === 'lights' && report.oceanContrast < 3)
      throw new Error('lights darkest band/ocean contrast below 3:1');
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await checkReshapedColors(), null, 2));
