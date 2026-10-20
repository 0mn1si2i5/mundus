import { z } from 'zod';
import {
  dataManifestObjectSchema,
  reshapedEarthManifestSchema,
} from './manifestSchemas';
export { reshapedEarthManifestSchema } from './manifestSchemas';
import mundusCountriesManifest from './manifests/mundus-countries.json';
import geoNamesMajorCitiesManifest from './manifests/geonames-major-cities.json';
import naturalEarthVectorManifest from './manifests/natural-earth-vector-globe.json';
import surnamesManifest from './manifests/surnames-by-country.json';
import countryLabelAnchorsManifest from './manifests/country-label-anchors.json';
import surnameLabelSlotsManifest from './manifests/surname-label-slots.json';
import surnameCoverageManifest from './manifests/surname-coverage.json';
import urbanIsolationManifest from './manifests/urban-isolation.json';
import reshapedEarthManifest from './manifests/reshaped-earth.json';

export const dataManifestSchema = z
  .union([
    reshapedEarthManifestSchema,
    dataManifestObjectSchema.refine(
      (manifest) => manifest.id !== 'reshaped-earth',
      {
        message: 'Reshaped Earth requires its dedicated manifest contract',
      },
    ),
  ])
  .superRefine((manifest, context) => {
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
    if (
      manifest.id === 'geonames-major-cities' &&
      manifest.immutableBuildInput?.schemaVersion !== 2
    ) {
      context.addIssue({
        code: 'custom',
        path: ['immutableBuildInput', 'schemaVersion'],
        message: 'GeoNames immutable input requires schema version 2',
      });
    }
  });

export type DataManifest = z.infer<typeof dataManifestSchema>;

// Reshaped Earth enters the registry only after its complete country asset set
// has passed the generated-data verifier.
export const DATA_MANIFESTS: readonly DataManifest[] = [
  dataManifestSchema.parse(mundusCountriesManifest),
  dataManifestSchema.parse(naturalEarthVectorManifest),
  dataManifestSchema.parse(geoNamesMajorCitiesManifest),
  dataManifestSchema.parse(surnamesManifest),
  dataManifestSchema.parse(countryLabelAnchorsManifest),
  dataManifestSchema.parse(surnameLabelSlotsManifest),
  dataManifestSchema.parse(surnameCoverageManifest),
  dataManifestSchema.parse(urbanIsolationManifest),
  dataManifestSchema.parse(reshapedEarthManifest),
];
