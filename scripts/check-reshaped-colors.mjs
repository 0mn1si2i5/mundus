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
  const {
    RESHAPED_METRIC_THEMES: themes,
    RESHAPED_METRIC_HUE_REFERENCES: hueReferences,
  } = await sourceModule('../src/features/reshaped/metrics.ts', (source) =>
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
  const modes = ['protan', 'deutan', 'tritan'];
  const result = Object.fromEntries(
    Object.entries(themes).map(([metric, theme]) => {
      const colors = theme.palette.map(math.hexToRgb);
      const paddingColors = colors.map((color) => math.desaturate(color));
      const adjacent = Object.fromEntries(
        modes.map((mode) => [
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
      const paddingDistance = (mode) =>
        colors.map((color, i) =>
          Math.min(
            ...[colors[i - 1], colors[i + 1]]
              .filter(Boolean)
              .map((neighbor) =>
                math.deltaE2000(
                  mode
                    ? math.simulateColorBlind(paddingColors[i], mode)
                    : paddingColors[i],
                  mode ? math.simulateColorBlind(neighbor, mode) : neighbor,
                ),
              ),
          ),
        );
      const ink = math.hexToRgb(theme.border);
      const casing = math.hexToRgb(theme.casing);
      const ocean = math.hexToRgb(theme.ocean);
      const casingContrast = (color, factor = 1) =>
        math.contrastRatio(
          math.applyLinearLight(ink, factor),
          math.applyLinearLight(
            math.compositeLinear(casing, color, theme.casingOpacity),
            factor,
          ),
        );
      const lch = colors.map(math.rgbToLch);
      const reference = hueReferences[metric];
      const hueDeviations = {
        smaller: lch
          .slice(0, 3)
          .map((color) => math.hueDifference(color[2], reference.smaller)),
        larger: lch
          .slice(4)
          .map((color) => math.hueDifference(color[2], reference.larger)),
      };
      const factors = [
        theme.light.ambient,
        theme.light.ambient + theme.light.directional,
      ];
      return [
        metric,
        {
          palette: theme.palette,
          ink: theme.border,
          casing: theme.casing,
          casingOpacity: theme.casingOpacity,
          selection: theme.selection,
          hueReference: reference,
          lch,
          hueDeviations,
          adjacent,
          padding: paddingDistance(null),
          paddingSimulated: Object.fromEntries(
            modes.map((mode) => [mode, paddingDistance(mode)]),
          ),
          casingContrast: colors.map((color) => casingContrast(color)),
          paddingCasingContrast: paddingColors.map((color) =>
            casingContrast(color),
          ),
          oceanCasingContrast: casingContrast(ocean),
          litCasingContrast: factors.map((factor) =>
            Math.min(
              ...[...colors, ...paddingColors, ocean].map((color) =>
                casingContrast(color, factor),
              ),
            ),
          ),
          luminance: colors.map(math.relativeLuminance),
          selectionContrast: math.contrastRatio(
            ink,
            math.hexToRgb(theme.selection),
          ),
          oceanContrast:
            metric === 'lights' ? math.contrastRatio(colors[0], ocean) : null,
          litOceanContrast:
            metric === 'lights'
              ? factors.map((factor) =>
                  math.contrastRatio(
                    math.applyLinearLight(colors[0], factor),
                    math.applyLinearLight(ocean, factor),
                  ),
                )
              : null,
        },
      ];
    }),
  );
  for (const [metric, report] of Object.entries(result)) {
    if (
      Math.max(
        ...report.hueDeviations.smaller,
        ...report.hueDeviations.larger,
      ) > 25
    )
      throw new Error(`${metric} side hue deviates more than 25 degrees`);
    if (
      report.lch.some(
        (color, index) => index !== 3 && color[1] <= report.lch[3][1],
      )
    )
      throw new Error(
        `${metric} neutral chroma is not lower than every side band`,
      );
    for (const mode of modes) {
      if (Math.min(...report.adjacent[mode]) < 10)
        throw new Error(`${metric} ${mode} adjacent ΔE00 below 10`);
      if (Math.min(...report.paddingSimulated[mode]) < 10)
        throw new Error(`${metric} ${mode} padding ΔE00 below 10`);
    }
    if (Math.min(...report.padding) < 10)
      throw new Error(`${metric} padding ΔE00 below 10`);
    const casingThreshold = metric === 'lights' ? 2 : 3;
    if (
      Math.min(
        ...report.casingContrast,
        ...report.paddingCasingContrast,
        report.oceanCasingContrast,
        ...report.litCasingContrast,
      ) < casingThreshold
    )
      throw new Error(
        `${metric} composited casing contrast below ${casingThreshold}:1`,
      );
    if (report.selectionContrast < 3)
      throw new Error(`${metric} selection contrast below 3:1`);
    const l = report.luminance;
    const monotonic =
      metric === 'lights'
        ? l.every((value, i) => i === 0 || value > l[i - 1])
        : l.slice(0, 4).every((value, i) => i === 0 || value > l[i - 1]) &&
          l.slice(4).every((value, i) => value < l[i + 3]);
    if (!monotonic)
      throw new Error(`${metric} luminance order is not monotonic`);
    if (
      metric === 'lights' &&
      Math.min(report.oceanContrast, ...report.litOceanContrast) < 1.5
    )
      throw new Error('lights darkest band/ocean contrast below 1.5:1');
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await checkReshapedColors(), null, 2));
