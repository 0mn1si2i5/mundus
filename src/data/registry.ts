import { z } from 'zod';
import naturalEarthManifest from './manifests/natural-earth-110m.json';
import geoNamesMajorCitiesManifest from './manifests/geonames-major-cities.json';
import naturalEarthVectorManifest from './manifests/natural-earth-vector-globe.json';
import surnamesManifest from './manifests/surnames-by-country.json';
import countryLabelAnchorsManifest from './manifests/country-label-anchors.json';
import surnameLabelSlotsManifest from './manifests/surname-label-slots.json';
import surnameCoverageManifest from './manifests/surname-coverage.json';

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

const dataManifestObjectSchema = z.object({
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
    .extend({ schemaVersion: z.literal(2) })
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
  sourceAssets: z
    .record(
      z.string(),
      z.object({
        distributionUrl: z.url(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
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

export const dataManifestSchema = dataManifestObjectSchema.superRefine(
  (manifest, context) => {
    if (
      manifest.id === 'geonames-major-cities' &&
      manifest.derivedAsset?.formatVersion !== 2
    ) {
      context.addIssue({
        code: 'custom',
        path: ['derivedAsset', 'formatVersion'],
        message: 'GeoNames derived asset requires runtime format version 2',
      });
    }
  },
);

export type DataManifest = z.infer<typeof dataManifestSchema>;

export const DATA_MANIFESTS: readonly DataManifest[] = [
  dataManifestSchema.parse(naturalEarthManifest),
  dataManifestSchema.parse(naturalEarthVectorManifest),
  dataManifestSchema.parse(geoNamesMajorCitiesManifest),
  dataManifestSchema.parse(surnamesManifest),
  dataManifestSchema.parse(countryLabelAnchorsManifest),
  dataManifestSchema.parse(surnameLabelSlotsManifest),
  dataManifestSchema.parse(surnameCoverageManifest),
];
