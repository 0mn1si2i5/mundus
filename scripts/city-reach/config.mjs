export const EARTH_RADIUS_METRES = 6_371_008.8;
export const MIN_POPULATION = 100_000;
export const LEVELS = Object.freeze([0.25, 0.5, 1, 2, 4, 8, 16]);
export const DEFAULT_LEVEL = 4;
export const GLOBAL_GRID = Object.freeze({
  width: 10_800,
  height: 4_350,
  west: -180,
  north: 85,
  step: 1 / 30,
  wrapLongitude: true,
});
export const QUALITY_TIERS = Object.freeze({
  // Density only sets brightness, so it is sampled at twice the owner stride.
  low: { stride: 4, densityStride: 8, tileColumns: 1, tileRows: 1 },
});
export const MAX_TEXTURE_BYTES = 3_000_000;
export const NO_OWNER = 0;
export const DISPUTED_OWNER = 65_535;
export const MAX_OWNER = DISPUTED_OWNER - 1;
export const MAP_COVERAGE =
  'Accessibility__202001_Global_Motorized_Friction_Surface';
export const MAP_ENDPOINT =
  'https://data.malariaatlas.org/geoserver/Accessibility/wcs';
export const GHSL_SOURCE = Object.freeze({
  url: 'https://cidportal.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_UCDB_GLOBE_R2024A/GHS_UCDB_GLOBE_R2024A/V1-1/GHS_UCDB_GLOBE_R2024A_V1_1.zip',
  sha256: '7b644df16b0791f88c3db28ce56338b5e1725be02b6a79ca253849822db26b21',
  licenseName: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
});
export const COUNTRY_SOURCES = Object.freeze({
  drawn: {
    url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries_chn.geojson',
    sha256: 'a13bf5f310fde87bc0a5f994f8ce9bd706cc198d8ee37d221e61c2546b945372',
  },
  route: {
    url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries.geojson',
    sha256: '239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255',
  },
});

export function tileRequests(grid = GLOBAL_GRID) {
  const south = grid.north - grid.height * grid.step;
  const east = grid.west + grid.width * grid.step;
  const result = [];
  for (
    let bottom = Math.floor(south / 10) * 10;
    bottom < grid.north;
    bottom += 10
  ) {
    for (let left = Math.floor(grid.west / 10) * 10; left < east; left += 10) {
      const bounds = {
        west: Math.max(left, grid.west),
        east: Math.min(left + 10, east),
        south: Math.max(bottom, south),
        north: Math.min(bottom + 10, grid.north),
      };
      const url = new URL(MAP_ENDPOINT);
      url.searchParams.set('service', 'WCS');
      url.searchParams.set('version', '2.0.1');
      url.searchParams.set('request', 'GetCoverage');
      url.searchParams.set('coverageId', MAP_COVERAGE);
      url.searchParams.set('format', 'image/tiff');
      url.searchParams.append('subset', `Long(${bounds.west},${bounds.east})`);
      url.searchParams.append('subset', `Lat(${bounds.south},${bounds.north})`);
      result.push({
        id: `${bounds.west}_${bounds.south}`,
        bounds,
        url: url.href,
      });
    }
  }
  return result;
}

export function estimateResources(grid = GLOBAL_GRID, cityCount = 5_944) {
  const cells = grid.width * grid.height;
  return {
    cells,
    cityCount,
    mapRequests: tileRequests(grid).length,
    // Implicit edges avoid the prototype's 111-million-entry CSR graph.
    fixedArrayBytes: cells * 41,
    peakBytesEstimate: Math.ceil(cells * 100 + 1024 * 1024 ** 2),
    aggregatedCacheBytesEstimate: cells * 11,
    fineLandAuditCacheBytesEstimate: cells * 2,
    computationCacheBytesEstimate: cells * 16,
    projectedRawDownloadBytes: tileRequests(grid).length * 1_200 * 1_200 * 4,
    retainedRawMapBytes: 0,
    duration:
      cells > 1_000_000
        ? 'Global timings require a regional benchmark; reference download about 1 hour and threshold solve about 2.5 hours.'
        : 'Bounded regional benchmark; timing is measured by the CLI.',
    qualityTiers: Object.fromEntries(
      Object.entries(QUALITY_TIERS).map(([name, tier]) => {
        const pixels =
          Math.ceil(grid.width / tier.stride) *
          Math.ceil(grid.height / tier.stride);
        const densityPixels =
          Math.ceil(grid.width / tier.densityStride) *
          Math.ceil(grid.height / tier.densityStride);
        return [
          name,
          {
            pixels,
            gpuBytes: pixels * 4,
            densityGpuBytes: densityPixels * 4,
            cpuOwnerBytes: pixels * 2,
            peakTransitionGpuBytes: pixels * 8 + densityPixels * 4,
          },
        ];
      }),
    ),
  };
}
