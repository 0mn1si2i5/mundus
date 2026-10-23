import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createServer } from 'vite';
import { feature } from 'topojson-client';

// SSR only: no listening HTTP server, browser, or network input.
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
});
try {
  const { isSurnameLabelSlotAllowed } = await server.ssrLoadModule(
    '/src/features/globe/surnameLabelSlots.ts',
  );
  const { LITERAL_NAMES } = await server.ssrLoadModule(
    '/src/features/names/literalNames.ts',
  );
  const { resolveLiteralNameWordmark } = await server.ssrLoadModule(
    '/src/features/names/literalNameWordmark.ts',
  );
  const { decodeSurnameDataset, getDisplaySurnameRecord } =
    await server.ssrLoadModule('/src/features/surnames/surnameData.ts');
  const { resolveSurnameWordmark, getSurnameWordmarkHeightRatio } =
    await server.ssrLoadModule('/src/features/surnames/surnameWordmark.ts');
  const sourcePaths = [
    'src/data/generated/surname-label-slots.json',
    'src/data/generated/mundus-countries-50m.json',
    'src/data/generated/surnames-by-country.json',
    'src/features/names/literalNames.ts',
    'src/features/names/literalNameWordmark.ts',
    'src/features/surnames/surnameNameForms.ts',
    'src/features/surnames/surnameWordmark.ts',
    'src/features/globe/surnameLabelSlots.ts',
    'src/features/globe/geo.ts',
    'src/features/antipodes/geography.ts',
    'scripts/build-wordmark-layouts.mjs',
    'pnpm-lock.yaml',
    'src/features/surnames/surnameData.ts',
  ];
  const inputs = Object.fromEntries(
    await Promise.all(
      sourcePaths.map(async (path) => {
        const bytes = await readFile(path);
        return [
          path,
          { bytes, sha256: createHash('sha256').update(bytes).digest('hex') },
        ];
      }),
    ),
  );
  const manifestPath = 'src/data/manifests/surname-label-slots.json';
  const manifest = JSON.parse(await readFile(manifestPath));
  const surnamesManifest = JSON.parse(
    await readFile('src/data/manifests/surnames-by-country.json'),
  );
  for (const [path, expected] of [
    [sourcePaths[0], manifest.derivedAssetSha256],
    [sourcePaths[1], manifest.sourceAssets['50m'].sha256],
    [sourcePaths[2], surnamesManifest.derivedAssetSha256],
  ])
    if (inputs[path].sha256 !== expected)
      throw new Error(`Pinned input mismatch: ${path}`);
  const slots = JSON.parse(inputs[sourcePaths[0]].bytes).slots;
  const topology = JSON.parse(inputs[sourcePaths[1]].bytes);
  const countries = feature(topology, topology.objects.countries).features;
  const marks = new Map();
  const add = (id, wordmark) => {
    if (wordmark)
      marks.set(`${id}:${wordmark.layout}:${wordmark.value}`, { id, wordmark });
  };
  for (const record of LITERAL_NAMES) {
    for (const locale of ['zh', 'en'])
      for (const label of ['literal', 'local'])
        add(record.id, resolveLiteralNameWordmark(record, label, locale));
  }
  const surnameData = decodeSurnameDataset(
    JSON.parse(inputs[sourcePaths[2]].bytes),
  );
  for (const country of surnameData.countries) {
    const record = getDisplaySurnameRecord(country);
    if (record)
      for (const mode of ['local', 'latin', 'chinese'])
        add(country.countryId, resolveSurnameWordmark(record, mode));
  }
  const layouts = {};
  for (const [key, { id, wordmark }] of [...marks].sort(([a], [b]) =>
    a.localeCompare(b, 'en'),
  )) {
    const ratio = getSurnameWordmarkHeightRatio(wordmark);
    layouts[key] = (slots[id] ?? []).flatMap((slot, index) => {
      if (
        !slot.landSafe ||
        (ratio >= 0.82 && Math.abs(slot.rotationDegrees) > 1e-6)
      )
        return [];
      const maximum =
        ratio >= 0.82
          ? slot.squareMax
          : ratio >= 0.42
            ? slot.mediumMax
            : slot.maxAngularDegrees;
      const allowed = (radius) =>
        isSurnameLabelSlotAllowed(
          { ...slot, maxAngularDegrees: radius },
          id,
          countries,
          wordmark,
        );
      let radius = maximum;
      if (!allowed(radius)) {
        let low = 0.0001,
          high = maximum;
        if (!allowed(low)) return [];
        for (let step = 0; step < 14; step++) {
          const middle = (low + high) / 2;
          if (allowed(middle)) low = middle;
          else high = middle;
        }
        radius = low;
      }
      radius = Number((radius * (1 - 1e-9)).toPrecision(12));
      if (!allowed(radius)) throw new Error(`Unstable envelope: ${key}`);
      return [[index, radius]];
    });
    if (layouts[key].length === 0)
      throw new Error(`No safe wordmark layout: ${key}`);
  }
  const output = {
    schemaVersion: 1,
    inputs: Object.fromEntries(
      Object.entries(inputs).map(([path, value]) => [path, value.sha256]),
    ),
    layouts,
  };
  const bytes = `${JSON.stringify(output)}\n`;
  const outputPath =
    process.env.WORDMARK_LAYOUT_OUTPUT ??
    'src/data/generated/wordmark-layouts.json';
  await writeFile(outputPath, bytes);
  const descriptor = {
    path: outputPath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    rawBytes: Buffer.byteLength(bytes),
    gzipBytes: gzipSync(bytes, { level: 9 }).length,
    wordCount: marks.size,
  };
  if (!process.env.WORDMARK_LAYOUT_OUTPUT) {
    manifest.wordmarkLayouts = descriptor;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  console.log(
    JSON.stringify({
      words: marks.size,
      rawBytes: Buffer.byteLength(bytes),
      gzipBytes: gzipSync(bytes, { level: 9 }).length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }),
  );
} finally {
  await server.close();
}
