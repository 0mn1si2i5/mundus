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

// Candidate Reshaped Earth assets are deliberately absent until all eight
// cartograms pass publication acceptance. Parsing an unaccepted candidate here
// would break existing observations that consume the shared registry.
export const DATA_MANIFESTS: readonly DataManifest[] = [
  dataManifestSchema.parse(mundusCountriesManifest),
  dataManifestSchema.parse(naturalEarthVectorManifest),
  dataManifestSchema.parse(geoNamesMajorCitiesManifest),
  dataManifestSchema.parse(surnamesManifest),
  dataManifestSchema.parse(countryLabelAnchorsManifest),
  dataManifestSchema.parse(surnameLabelSlotsManifest),
  dataManifestSchema.parse(surnameCoverageManifest),
  dataManifestSchema.parse(urbanIsolationManifest),
];
