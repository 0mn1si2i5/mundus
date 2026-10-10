import { z } from 'zod';
import { inverseTextureBytesFromDescriptor } from '../features/reshaped/inverseSampling.mjs';

const auxiliarySourceSchema = z.object({
  sourceName: z.string().min(1),
  distributionUrl: z.url(),
  version: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  purpose: z.string().min(1),
});

const capturedSourceSchema = z.object({
  sourceName: z.string().min(1),
  distributionUrl: z.url(),
  fileName: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  rawBytes: z.number().int().positive(),
  etag: z.string().nullable(),
  lastModified: z.string().nullable(),
});

const trackedAssetIdentitySchema = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  rawBytes: z.number().int().positive(),
});

export const dataManifestObjectSchema = z.object({
  id: z.string().min(1),
  sourceName: z.string().min(1),
  sourceUrl: z.url(),
  distributionUrl: z.url().optional(),
  licenseName: z.string().min(1),
  licenseUrl: z.url(),
  version: z.string().min(1),
  retrievedAt: z.iso.date(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  derivedAssetSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  auxiliarySources: z.array(auxiliarySourceSchema).optional(),
  upstreamCapture: z
    .object({
      retrievedAt: z.iso.datetime({ offset: true }),
      sources: z.array(capturedSourceSchema).length(5),
    })
    .optional(),
  immutableBuildInput: trackedAssetIdentitySchema
    .extend({ schemaVersion: z.union([z.literal(1), z.literal(2)]) })
    .optional(),
  derivedAsset: trackedAssetIdentitySchema
    .extend({ formatVersion: z.number().int().optional() })
    .optional(),
  attribution: z.string().min(1),
  redistribution: z.enum(['allowed', 'restricted', 'unknown']),
  transformations: z.array(z.string().min(1)).min(1),
  missingValuePolicy: z.string().min(1),
  boundaryPolicy: z.string().min(1),
  coverageNote: z.string().min(1).optional(),
  recordCount: z.number().int().nonnegative().optional(),
  rawBytes: z.number().int().nonnegative().optional(),
  gzipBytes: z.number().int().nonnegative().optional(),
  staticDecodedBytesEstimate: z.number().int().nonnegative().optional(),
  runtimeDecodedBytesEstimate: z.number().int().nonnegative().optional(),
  topologyAssets: z
    .record(
      z.string(),
      z.object({
        path: z.string().min(1),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        rawBytes: z.number().int().positive(),
        gzipBytes: z.number().int().positive(),
        countries: z.number().int().positive(),
        arcs: z.number().int().positive(),
        points: z.number().int().positive(),
      }),
    )
    .optional(),
  sourceAssets: z
    .record(
      z.string(),
      // An upstream download (distributionUrl) or a generated asset in this
      // repository (path); either way the hash identifies exactly that file.
      z
        .object({
          distributionUrl: z.url().optional(),
          path: z.string().min(1).optional(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .refine(
          (source) =>
            (source.distributionUrl === undefined) !==
            (source.path === undefined),
          {
            message:
              'Source asset needs exactly one of distributionUrl or path',
          },
        ),
    )
    .optional(),
  derivedAssets: z
    .record(
      z.string(),
      z.object({
        path: z.string().min(1),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        rawBytes: z.number().int().positive(),
        gzipBytes: z.number().int().positive(),
        gpuBytes: z.number().int().positive(),
        runtimeGpuBytes: z.number().int().positive(),
        paletteBytes: z.number().int().positive(),
        countries: z.number().int().positive(),
        vertices: z.number().int().positive(),
        triangles: z.number().int().positive(),
        coastlineVertices: z.number().int().positive(),
        borderVertices: z.number().int().positive(),
        droppedDegenerateTriangles: z.number().int().nonnegative(),
        droppedOutsideTriangles: z.number().int().nonnegative(),
        maxEdgeDegrees: z.number().positive(),
        containmentSamplesPerTriangle: z.number().int().positive(),
        candidateAreaSteradians: z.number().positive(),
        acceptedAreaSteradians: z.number().positive(),
        droppedOutsideAreaSteradians: z.number().nonnegative(),
        droppedOutsideAreaFraction: z.number().min(0).max(1),
        representativeDroppedAreaFractions: z.record(
          z.string(),
          z.number().min(0).max(1),
        ),
        sourceCountryFeatureAreaSteradians: z.number().positive(),
        sourceLandUnionAreaSteradians: z.number().positive(),
        emittedAreaSteradians: z.number().positive(),
        sourceAreaDeficitFraction: z.number().min(0).max(1),
        largestPartDeficits: z.array(
          z.object({
            countryId: z.string().min(1),
            partIndex: z.number().int().nonnegative(),
            sourceAreaSteradians: z.number().nonnegative(),
            acceptedAreaSteradians: z.number().nonnegative(),
            deficitFraction: z.number().min(0).max(1),
          }),
        ),
        largestCountryDeficits: z.array(
          z.object({
            countryId: z.string().min(1),
            sourceAreaSteradians: z.number().positive(),
            emittedAreaSteradians: z.number().nonnegative(),
            deficitFraction: z.number().min(0).max(1),
            sourceSelfIntersections: z.number().int().nonnegative(),
          }),
        ),
      }),
    )
    .optional(),
});

const reshapedMetrics = ['population', 'gdp', 'co2', 'lights'] as const;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const reshapedAssetIdentitySchema = trackedAssetIdentitySchema.extend({
  gzipBytes: z.number().int().positive(),
  gpuBytes: z.number().int().nonnegative(),
});
const reshapedDerivedAssetSchema = z.discriminatedUnion('kind', [
  reshapedAssetIdentitySchema
    .extend({
      kind: z.literal('metadata'),
      content: z.enum(['units', 'values']),
    })
    .strict(),
  reshapedAssetIdentitySchema
    .extend({
      kind: z.literal('id-raster'),
      width: z.literal(4096),
      height: z.literal(2048),
      encoding: z.literal('country-padding-rg8'),
    })
    .strict(),
  reshapedAssetIdentitySchema
    .extend({
      kind: z.literal('inverse-field'),
      metric: z.enum(reshapedMetrics),
      width: z.literal(1024),
      height: z.literal(512),
      encoding: z.literal('regular-node-int16'),
      stepLongitude: z.number().positive().max(0.14),
      stepS: z.number().positive().max(0.001),
    })
    .strict(),
]);
const reshapedAcceptanceSchema = z
  .object({
    triangleOrientation: z.literal(true),
    minimumTriangleArea: z.number().positive(),
    medianAreaError: z.number().nonnegative().lt(0.05),
    p90AreaError: z.number().nonnegative().lt(0.15),
    rawMedianAreaError: z.number().nonnegative(),
    rawP90AreaError: z.number().nonnegative(),
    totalAreaRelativeError: z.number().nonnegative().lt(1e-6),
    quantizationMaxDegrees: z.number().nonnegative().lt(0.01),
    iterations: z.number().int().min(1).max(16),
    unitsChecked: z.number().int().positive().max(239),
    displaySamples: z.number().int().min(400_000),
    displaySeed: z.number().int().nonnegative(),
    displayP50Degrees: z.number().nonnegative(),
    displayP99Degrees: z.number().nonnegative().max(0.1),
    displayP999Degrees: z.number().nonnegative().max(0.5),
    displayMaxDegrees: z.number().nonnegative(),
  })
  .strict();
const reshapedParametersSchema = z
  .object({
    algorithm: z.literal('gsm2018-fast-flow'),
    grid: z.tuple([z.literal(2048), z.literal(1024)]),
    initialBlur: z.number().positive(),
    blurSchedule: z.array(z.number().positive()).min(1).max(16),
    integrationTolerance: z.number().positive(),
    maxRounds: z.number().int().min(1).max(16),
    stopReason: z.enum(['raw-pass', 'plateau', 'max-rounds']),
    minimumJacobian: z.number().positive(),
    regularizationPasses: z.number().int().positive(),
    quantization: z
      .object({
        rule: z.literal(
          'minimum-gzip6-among-15-choices-with-source-quantization-lt-0.01-and-display-p99-le-0.1-p999-le-0.5',
        ),
        stepLongitudeFactor: z.union(
          [2, 4, 8, 16, 24].map((factor) => z.literal(factor)),
        ),
        stepSFactor: z.union([z.literal(1), z.literal(1.25), z.literal(1.5)]),
        stepLongitude: z.number().positive().max(0.14),
        stepS: z.number().positive().max(0.001),
      })
      .strict(),
  })
  .strict();
const reshapedDeterminismSchema = z
  .object({
    builds: z.literal(2),
    byteIdentical: z.literal(true),
    forwardSha256: sha256Schema,
    inverseSha256: sha256Schema,
    paddingSha256: sha256Schema,
  })
  .strict();
const reshapedPaddingCountrySchema = z
  .object({
    id: z.string().min(1),
    paletteIndex: z.number().int().min(1).max(239),
    actualArea: z.number().positive(),
    targetArea: z.number().positive(),
    coreArea: z.number().positive(),
    paddingArea: z.number().positive(),
    rasterActualArea: z.number().positive(),
    paddingFraction: z.number().positive().max(1),
    onePixelRelativeError: z.number().nonnegative(),
  })
  .strict();
const reshapedPaddingSchema = z
  .object({
    countries: z.array(reshapedPaddingCountrySchema).max(239),
    skippedCountries: z
      .array(
        z
          .object({
            id: z.string().min(1),
            paletteIndex: z.number().int().min(1).max(239),
            pixelCount: z.number().int().nonnegative().max(63),
          })
          .strict(),
      )
      .max(239),
    maxFraction: z.number().min(0).max(1),
    algorithm: z.literal('spherical-chamfer-8'),
    triggerRatio: z.literal(1.1),
    minimumPixels: z.literal(64),
  })
  .strict();

export const reshapedEarthManifestSchema = dataManifestObjectSchema
  .omit({ derivedAssets: true, sourceAssets: true })
  .extend({
    id: z.literal('reshaped-earth'),
    formatVersion: z.literal(4),
    publishedMetrics: z.array(z.enum(reshapedMetrics)).min(3).max(4),
    unpublishedMetrics: z.array(z.literal('gdp')).max(1),
    metricBits: z
      .object({
        population: z.literal(0),
        gdp: z.literal(1),
        co2: z.literal(2),
        lights: z.literal(3),
      })
      .strict(),
    year: z.literal(2020),
    grid: z
      .object({
        projection: z.literal('cylindrical-equal-area'),
        width: z.literal(2048),
        height: z.literal(1024),
      })
      .strict(),
    sources: z
      .array(
        z
          .object({
            id: z.string().min(1),
            name: z.string().min(1),
            url: z.url(),
            license: z.enum(['CC BY 4.0', 'Public domain']),
            year: z.literal(2020).optional(),
          })
          .strict(),
      )
      .min(6)
      .max(7),
    sourceAssets: z.record(
      z.string(),
      z
        .object({
          key: z.string().min(1),
          published: z.boolean(),
          fileName: z.string().min(1),
          distributionUrl: z.url(),
          sha256: sha256Schema,
          rawBytes: z.number().int().positive(),
          licenseName: z.enum(['CC BY 4.0', 'Public domain']),
          licenseUrl: z.url(),
          version: z.string().min(1),
          retrievedAt: z.iso.date(),
          year: z.literal(2020).optional(),
          selection: z.string().min(1),
        })
        .strict(),
    ),
    derivedAssets: z.record(z.string(), reshapedDerivedAssetSchema),
    acceptance: z.partialRecord(
      z.enum(reshapedMetrics),
      reshapedAcceptanceSchema,
    ),
    parameters: z.partialRecord(
      z.enum(reshapedMetrics),
      reshapedParametersSchema,
    ),
    determinism: z.partialRecord(
      z.enum(reshapedMetrics),
      reshapedDeterminismSchema,
    ),
    padding: z.partialRecord(z.enum(reshapedMetrics), reshapedPaddingSchema),
    nameCoverage: z
      .object({
        countries: z.literal(239),
        chinese: z.literal(239),
        fraction: z.literal(1),
      })
      .strict(),
    unassigned: z.record(z.enum(reshapedMetrics), z.number().min(0).max(1)),
    aggregation: z.record(
      z.enum(reshapedMetrics),
      z
        .object({
          published: z.boolean(),
          diagnostics: z.object({
            validTotal: z.number().positive(),
            assignedTotal: z.number().positive(),
            unassigned: z.number().nonnegative(),
            relativeError: z.number().nonnegative().lt(1e-9),
            unassignedFraction: z.number().min(0).max(1),
          }),
          metadata: z.record(z.string(), z.unknown()),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((manifest, context) => {
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: 'custom', path, message });
    const expectedAssets = new Set([
      'units.json',
      'values.json',
      'ids-country.png',
      ...manifest.publishedMetrics.map((metric) => `inverse-${metric}.bin`),
    ]);
    const expectedPublished = reshapedMetrics.filter(
      (metric) => metric !== 'gdp' || manifest.publishedMetrics.includes('gdp'),
    );
    if (
      JSON.stringify(manifest.publishedMetrics) !==
      JSON.stringify(expectedPublished)
    )
      issue(
        ['publishedMetrics'],
        'Publish population, CO2 and lights with optional GDP in stable order',
      );
    if (
      JSON.stringify(manifest.unpublishedMetrics) !==
      JSON.stringify(manifest.publishedMetrics.includes('gdp') ? [] : ['gdp'])
    )
      issue(
        ['unpublishedMetrics'],
        'Unpublished GDP must match the runtime metric set',
      );
    for (const record of [
      'acceptance',
      'parameters',
      'determinism',
      'padding',
    ] as const)
      if (
        JSON.stringify(Object.keys(manifest[record]).sort()) !==
        JSON.stringify([...manifest.publishedMetrics].sort())
      )
        issue([record], 'Records must match the published metric set');
    const expectedSources = new Set([
      ...reshapedMetrics,
      'admin1',
      'chn',
      'default',
    ]);
    for (const key of expectedSources)
      if (!manifest.sourceAssets[key])
        issue(['sourceAssets', key], 'Required pinned source missing');
    for (const [key, source] of Object.entries(manifest.sourceAssets)) {
      if (!expectedSources.has(key) || source.key !== key)
        issue(['sourceAssets', key], 'Unexpected or mismatched source key');
      const published =
        key !== 'gdp' || manifest.publishedMetrics.includes('gdp');
      if (source.published !== published)
        issue(
          ['sourceAssets', key, 'published'],
          'Source publication flag differs',
        );
      if (
        reshapedMetrics.includes(key as (typeof reshapedMetrics)[number]) &&
        source.year !== 2020
      )
        issue(['sourceAssets', key, 'year'], 'Metric source must select 2020');
    }
    for (const name of expectedAssets)
      if (!manifest.derivedAssets[name])
        issue(['derivedAssets', name], 'Required country asset missing');
    for (const [name, asset] of Object.entries(manifest.derivedAssets)) {
      const expectedName =
        asset.kind === 'metadata'
          ? `${asset.content}.json`
          : asset.kind === 'id-raster'
            ? 'ids-country.png'
            : `inverse-${asset.metric}.bin`;
      if (
        !expectedAssets.has(name) ||
        name !== expectedName ||
        asset.path !== `src/data/generated/reshaped-earth/${name}`
      )
        issue(
          ['derivedAssets', name],
          'Asset identity must match the country asset set',
        );
      if (asset.kind === 'metadata' && asset.gpuBytes !== 0)
        issue(
          ['derivedAssets', name, 'gpuBytes'],
          'Metadata has no GPU texture',
        );
      if (asset.kind === 'id-raster') {
        if (asset.rawBytes > 900_000)
          issue(
            ['derivedAssets', name, 'rawBytes'],
            'ID raster exceeds 900000 bytes',
          );
        if (asset.gpuBytes !== 4096 * 2048 * 2)
          issue(
            ['derivedAssets', name, 'gpuBytes'],
            'IDs use lossless RG8 bytes',
          );
      }
      if (asset.kind === 'inverse-field') {
        if (asset.rawBytes > 1_200_000 || asset.gzipBytes > 700_000)
          issue(
            ['derivedAssets', name],
            'Inverse raw or gzip-6 transfer budget exceeded',
          );
        if (asset.gpuBytes !== inverseTextureBytesFromDescriptor(asset))
          issue(
            ['derivedAssets', name, 'gpuBytes'],
            'Inverse GPU budget uses all periodic nodes',
          );
        const steps = manifest.parameters[asset.metric]?.quantization;
        if (
          steps?.stepLongitude !== asset.stepLongitude ||
          steps?.stepS !== asset.stepS
        )
          issue(
            ['parameters', asset.metric, 'quantization'],
            'Selected quantization steps must match the shipped field',
          );
        if (manifest.determinism[asset.metric]?.inverseSha256 !== asset.sha256)
          issue(
            ['determinism', asset.metric, 'inverseSha256'],
            'Rebuilt inverse hash must match the shipped asset',
          );
      }
    }
    const metadataBytes =
      (manifest.derivedAssets['units.json']?.gzipBytes ?? 0) +
      (manifest.derivedAssets['values.json']?.gzipBytes ?? 0);
    if (metadataBytes > 60_000)
      issue(['derivedAssets'], 'Metadata exceeds 60000 gzip-6 bytes');
    const initialBytes =
      metadataBytes +
      (manifest.derivedAssets['ids-country.png']?.gzipBytes ?? 0) +
      (manifest.derivedAssets['inverse-population.bin']?.gzipBytes ?? 0);
    if (initialBytes > 1_800_000)
      issue(['derivedAssets'], 'Initial population transfer exceeds 1.8 MB');
    const largestInverse = Math.max(
      0,
      ...Object.values(manifest.derivedAssets)
        .filter((asset) => asset.kind === 'inverse-field')
        .map((asset) => asset.gpuBytes),
    );
    const paletteBytes = Math.ceil((239 + 1) / 256) * 256 * 16;
    if (2 * largestInverse + 4096 * 2048 * 2 + paletteBytes > 40 * 1024 ** 2)
      issue(
        ['derivedAssets'],
        'Current and preceding inverses, RG8 IDs and palette exceed 40 MiB',
      );
    for (const metric of manifest.publishedMetrics) {
      const result = manifest.acceptance[metric],
        parameters = manifest.parameters[metric];
      if (!result || !parameters) continue;
      const padding = manifest.padding[metric];
      if (padding) {
        if (
          new Set(padding.countries.map((country) => country.id)).size !==
            padding.countries.length ||
          new Set(padding.countries.map((country) => country.paletteIndex))
            .size !== padding.countries.length
        )
          issue(['padding', metric], 'Padding countries must be unique');
        for (const country of padding.countries)
          if (
            !(country.actualArea > 1.1 * country.targetArea) ||
            Math.abs(
              country.paddingFraction -
                country.paddingArea / country.actualArea,
            ) > 1e-10 ||
            Math.abs(country.coreArea - country.targetArea) /
              country.targetArea >
              country.onePixelRelativeError + 1e-10 ||
            Math.abs(
              country.actualArea - country.coreArea - country.paddingArea,
            ) > 1e-10
          )
            issue(
              ['padding', metric, country.id],
              'Padding must preserve the intended core within one pixel',
            );
        if (
          padding.maxFraction !==
          Math.max(
            0,
            ...padding.countries.map((country) => country.paddingFraction),
          )
        )
          issue(
            ['padding', metric, 'maxFraction'],
            'Maximum padding fraction differs from country records',
          );
      }
      if (
        result.displayP50Degrees > result.displayP99Degrees ||
        result.displayP99Degrees > result.displayP999Degrees ||
        result.displayP999Degrees > result.displayMaxDegrees
      )
        issue(
          ['acceptance', metric],
          'Display-space quantiles must be ordered',
        );
      if (
        parameters.blurSchedule.length !== result.iterations ||
        result.iterations > parameters.maxRounds
      )
        issue(
          ['parameters', metric],
          'Solver schedule must match the accepted iteration count',
        );
    }
    for (const metric of reshapedMetrics)
      if (
        manifest.aggregation[metric].published !==
        manifest.publishedMetrics.includes(metric)
      )
        issue(
          ['aggregation', metric, 'published'],
          'Aggregation publication flag differs',
        );
    if (!(manifest.unassigned.population < 0.005))
      issue(
        ['unassigned', 'population'],
        'Unassigned population must be below 0.5%',
      );
  });
