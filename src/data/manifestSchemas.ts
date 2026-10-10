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
const reshapedLevels = ['country', 'admin1'] as const;
const reshapedAssetIdentitySchema = trackedAssetIdentitySchema.extend({
  gzipBytes: z.number().int().positive(),
  gpuBytes: z.number().int().nonnegative(),
});
const reshapedDerivedAssetSchema = z.discriminatedUnion('kind', [
  reshapedAssetIdentitySchema
    .extend({
      kind: z.literal('metadata'),
      content: z.enum(['units', 'values', 'boundary-adjustments']),
    })
    .strict(),
  reshapedAssetIdentitySchema
    .extend({
      kind: z.literal('id-raster'),
      level: z.enum(reshapedLevels),
      width: z.literal(4096),
      height: z.literal(2048),
      encoding: z.literal('rgb24'),
    })
    .strict(),
  reshapedAssetIdentitySchema
    .extend({
      kind: z.literal('inverse-field'),
      metric: z.enum(reshapedMetrics),
      level: z.enum(reshapedLevels),
      width: z.number().int().positive().max(1024),
      height: z.number().int().positive().max(512),
      encoding: z.enum(['int16-meshopt', 'adaptive-quadtree-int16']),
      treeNodes: z.number().int().positive().optional(),
      leafCount: z.number().int().positive().optional(),
      maxDepth: z.number().int().min(0).max(8).optional(),
      stepLongitude: z.number().positive().max(0.02),
      stepS: z.number().positive().max(0.001).optional(),
      verticalCoordinate: z.literal('latitude').optional(),
      stepLatitude: z.number().positive().max(0.02).optional(),
    })
    .strict(),
]);

const reshapedAcceptanceSchema = z.object({
  triangleOrientation: z.literal(true),
  medianAreaError: z.number().nonnegative().lt(0.05),
  p90AreaError: z.number().nonnegative().lt(0.15),
  roundTripP999Degrees: z.number().nonnegative().lt(0.05),
  roundTripMaxDegrees: z.number().nonnegative().lt(0.5),
  totalAreaRelativeError: z.number().nonnegative().lt(1e-6),
  quantizationMaxDegrees: z.number().nonnegative().lt(0.01),
  iterations: z.number().int().min(1).max(6),
  unitsChecked: z.number().int().positive(),
  algorithm: z.enum(['gsm2018-fast-flow', 'composed-gsm2018-fast-flow']),
  edgeJumpMaxDegrees: z.number().nonnegative().lt(0.01).optional(),
});

export const reshapedEarthManifestSchema = dataManifestObjectSchema
  .omit({ derivedAssets: true, sourceAssets: true })
  .extend({
    id: z.literal('reshaped-earth'),
    formatVersion: z.literal(1),
    year: z.literal(2020),
    grid: z.object({
      projection: z.literal('cylindrical-equal-area'),
      width: z.union([z.literal(2048), z.literal(4096)]),
      height: z.union([z.literal(1024), z.literal(2048)]),
    }),
    materialMeshes: z
      .object({
        country: z.object({
          width: z.union([z.literal(2048), z.literal(4096)]),
          height: z.union([z.literal(1024), z.literal(2048)]),
        }),
        admin1: z.object({
          width: z.union([z.literal(2048), z.literal(4096)]),
          height: z.union([z.literal(1024), z.literal(2048)]),
        }),
      })
      .optional(),
    sources: z.array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        url: z.url(),
        license: z.enum(['CC BY 4.0', 'Public domain']),
        year: z.literal(2020).optional(),
      }),
    ),
    sourceAssets: z.record(
      z.string(),
      z
        .object({
          key: z.string().min(1),
          fileName: z.string().min(1),
          distributionUrl: z.url(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
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
    acceptance: z.record(z.string(), reshapedAcceptanceSchema),
    boundaryAdjustments: z.array(z.record(z.string(), z.unknown())),
    nameCoverage: z.object({
      admin1: z.number().int().positive(),
      chinese: z.number().int().nonnegative(),
      fraction: z.number().min(0).max(1),
      naturalEarthAdmin1: z.number().int().nonnegative(),
      wholeCountryFallback: z.number().int().nonnegative(),
    }),
    unassigned: z.record(z.enum(reshapedMetrics), z.number().min(0).max(1)),
    aggregation: z.record(
      z.enum(reshapedMetrics),
      z.object({
        diagnostics: z.object({
          validTotal: z.number().positive(),
          assignedTotal: z.number().positive(),
          unassigned: z.number().nonnegative(),
          relativeError: z.number().nonnegative().lt(1e-9),
          unassignedFraction: z.number().min(0).max(1),
        }),
        metadata: z.record(z.string(), z.unknown()),
      }),
    ),
  })
  .superRefine((manifest, context) => {
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: 'custom', path, message });
    const expectedAssets = new Set([
      'units.json',
      'values.json',
      'boundary-adjustments.json',
    ]);
    if (manifest.grid.width !== manifest.grid.height * 2)
      issue(['grid'], 'Equal-area mesh dimensions must have a 2:1 ratio');
    for (const [level, mesh] of Object.entries(manifest.materialMeshes ?? {}))
      if (mesh.width !== mesh.height * 2)
        issue(
          ['materialMeshes', level],
          'Material mesh dimensions must have a 2:1 ratio',
        );
    const expectedAcceptance = new Set<string>();
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
      if (
        reshapedMetrics.includes(key as (typeof reshapedMetrics)[number]) &&
        source.year !== 2020
      )
        issue(['sourceAssets', key, 'year'], 'Metric source must select 2020');
    }
    for (const level of reshapedLevels) {
      expectedAssets.add(`ids-${level}.png`);
      for (const metric of reshapedMetrics) {
        expectedAssets.add(`inverse-${metric}-${level}.bin`);
        expectedAcceptance.add(`${metric}-${level}`);
      }
    }
    for (const key of expectedAssets)
      if (!manifest.derivedAssets[key])
        issue(['derivedAssets', key], 'Required Reshaped Earth asset missing');
    for (const [name, asset] of Object.entries(manifest.derivedAssets)) {
      if (!expectedAssets.has(name))
        issue(['derivedAssets', name], 'Unexpected Reshaped Earth asset');
      if (asset.path !== `src/data/generated/reshaped-earth/${name}`)
        issue(['derivedAssets', name, 'path'], 'Asset path must match its key');
      const expectedName =
        asset.kind === 'metadata'
          ? `${asset.content}.json`
          : asset.kind === 'id-raster'
            ? `ids-${asset.level}.png`
            : `inverse-${asset.metric}-${asset.level}.bin`;
      if (name !== expectedName)
        issue(['derivedAssets', name], 'Asset identity must match its key');
      const limit =
        asset.kind === 'metadata'
          ? (asset.content === 'units'
              ? 120
              : asset.content === 'values'
                ? 150
                : Infinity) * 1024
          : asset.kind === 'inverse-field'
            ? (asset.level === 'country' ? 4 : 8) * 1024 * 1024
            : 900 * 1024;
      if (
        asset.gzipBytes > limit ||
        (asset.kind !== 'metadata' && asset.rawBytes > limit)
      )
        issue(
          ['derivedAssets', name],
          'Reshaped Earth transfer budget exceeded',
        );
      if (
        asset.kind === 'inverse-field' &&
        (asset.encoding === 'adaptive-quadtree-int16'
          ? (asset.width & (asset.width - 1)) !== 0 ||
            (asset.height & (asset.height - 1)) !== 0 ||
            !asset.treeNodes ||
            !asset.leafCount ||
            asset.maxDepth === undefined
          : asset.width !== (asset.level === 'country' ? 512 : 1024) ||
            asset.height !== (asset.level === 'country' ? 256 : 512))
      )
        issue(['derivedAssets', name], 'Inverse dimensions must match level');
      if (
        asset.kind === 'inverse-field' &&
        (asset.verticalCoordinate === 'latitude'
          ? asset.encoding !== 'adaptive-quadtree-int16' ||
            asset.stepLatitude === undefined ||
            asset.stepS !== undefined
          : asset.stepS === undefined || asset.stepLatitude !== undefined)
      )
        issue(
          ['derivedAssets', name],
          'Inverse vertical coordinate and quantization step must agree',
        );
      if (
        asset.kind === 'inverse-field' &&
        asset.encoding === 'adaptive-quadtree-int16'
      ) {
        const roots = asset.width * asset.height;
        if (
          !asset.treeNodes ||
          !asset.leafCount ||
          asset.treeNodes < roots ||
          (asset.treeNodes - roots) % 4 !== 0 ||
          asset.leafCount !== roots + (3 * (asset.treeNodes - roots)) / 4
        )
          issue(
            ['derivedAssets', name],
            'Adaptive tree and leaf counts must agree',
          );
        const gpuBytes = inverseTextureBytesFromDescriptor(asset);
        if (asset.gpuBytes !== gpuBytes || gpuBytes > 12 * 1024 ** 2)
          issue(
            ['derivedAssets', name, 'gpuBytes'],
            'Inverse GPU bytes must include texture padding',
          );
        if (
          manifest.acceptance[`${asset.metric}-${asset.level}`]
            ?.edgeJumpMaxDegrees === undefined
        )
          issue(
            [
              'acceptance',
              `${asset.metric}-${asset.level}`,
              'edgeJumpMaxDegrees',
            ],
            'Adaptive field requires independent edge continuity measurement',
          );
      } else if (
        asset.kind === 'inverse-field' &&
        asset.gpuBytes !== inverseTextureBytesFromDescriptor(asset)
      )
        issue(
          ['derivedAssets', name, 'gpuBytes'],
          'Regular inverse GPU bytes must include placeholders',
        );
      else if (
        asset.kind === 'id-raster' &&
        asset.gpuBytes !== asset.width * asset.height * 2
      )
        issue(
          ['derivedAssets', name, 'gpuBytes'],
          'GPU IDs use lossless RG8 bytes',
        );
    }
    for (const key of expectedAcceptance)
      if (!manifest.acceptance[key])
        issue(['acceptance', key], 'Required cartogram acceptance missing');
    const largestInverse = Math.max(
      0,
      ...Object.values(manifest.derivedAssets)
        .filter((asset) => asset.kind === 'inverse-field')
        .map((asset) => asset.gpuBytes),
    );
    if (largestInverse * 2 + 4096 * 2048 * 2 > 40 * 1024 ** 2)
      issue(
        ['derivedAssets'],
        'Two active inverse fields and RG8 IDs exceed GPU budget',
      );
    for (const key of Object.keys(manifest.acceptance))
      if (!expectedAcceptance.has(key))
        issue(['acceptance', key], 'Unexpected cartogram acceptance');
    if (!(manifest.unassigned.population < 0.005))
      issue(
        ['unassigned', 'population'],
        'Unassigned population must be below 0.5%',
      );
    if (
      manifest.nameCoverage.chinese > manifest.nameCoverage.admin1 ||
      manifest.nameCoverage.naturalEarthAdmin1 +
        manifest.nameCoverage.wholeCountryFallback !==
        manifest.nameCoverage.admin1 ||
      Math.abs(
        manifest.nameCoverage.fraction -
          manifest.nameCoverage.chinese / manifest.nameCoverage.admin1,
      ) > 1e-12
    )
      issue(['nameCoverage'], 'Name coverage counts must agree');
  });
