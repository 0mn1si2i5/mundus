# Reshaped Earth data and method contract

Reshaped Earth asks how the Earth's shape changes when area follows people,
PPP GDP, fossil-fuel and cement CO₂ emissions, or night lights. It is a static
educational cartogram, with country and first-level administrative units only.
All four quantities use **2020**, and the two statistical levels describe the
same underlying totals. A place in a share URL always keeps its true geographic
coordinates; animation progress is not part of the URL.

The builder publishes only after all eight maps pass the acceptance below.
Unaccepted candidates stay outside the shared data registry, and release
verification rejects them. The manifest identifies the published data and
measurements; a partial or synthetic candidate does not establish readiness.

## Sources and interpretation

The source register, `scripts/reshaped-earth/sources.mjs`, pins version,
distribution URL, file identity and SHA-256. At publication,
`src/data/manifests/reshaped-earth.json` must record those source identities
and actual derived hashes, sizes and acceptance measurements. Source landing pages and
terms were checked on 2026-10-10. Data-source attribution is also published in
`DATA_SOURCES.md`, `THIRD_PARTY_LICENSES.md` and the bilingual About dialog.

| Quantity     | Source                                                                         | Published sample                                                                | Unit and terms                                  |
| ------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------- |
| Population   | European Commission, Joint Research Centre, GHS-POP R2023A V1-0                | Epoch 2020, WGS84, 30 arcseconds                                                | Persons; CC BY 4.0                              |
| GDP          | Kummu et al., global downscaled GDP grids v4, Zenodo record 18429133           | `rast_gdpTot_1990_2024_5arcmin.tif`, band whose own description identifies 2020 | **2021 international dollars (PPP)**; CC BY 4.0 |
| CO₂          | Jones et al., GCP-GridFED v2025.1, complete UEA 2020 archive                   | Twelve monthly oil, coal, gas and cement-calcination layers                     | Tonnes CO₂/year; CC BY 4.0                      |
| Night lights | Li, Zhou, Zhao & Zhao, harmonized DMSP–VIIRS NTL v10, figshare article 9828827 | `Harmonized_DN_NTL_2020_simVIIRS.tif`                                           | Sum of relative DN 0–63; CC BY 4.0              |
| Boundaries   | Natural Earth 5.1.2 admin-1 and full-detail Mundus countries                   | The pinned 1:10m GeoJSONs, before display simplification                        | Public domain                                   |

GDP v4's metadata explicitly specifies **2021** international dollars. Older
dataset descriptions using 2017 international dollars do not describe this
version. The GDP reader inspects sample descriptions and requires exactly one
2020 match; it does not assume a band number without checking it.

GridFED variable dimensions, coordinates, year and units are checked before
reading. Oil, gas, coal and cement-calcination kilograms per month are summed
over twelve months and converted to tonnes. International aviation and
shipping bunkers and cement-carbonation uptake are excluded. This is not a
territorial greenhouse-gas inventory and does not include land-use change,
methane or other gases. EDGAR and alternate sample years are not substitutes.

Night-light DN is a relative, harmonized brightness index. Summing it is a
comparison of the published index, not a measurement of emitted radiant energy,
electricity consumption or income. DN saturates at 63. GDP and population are
modelled spatial estimates; detailed administrative values are not independent
official census or economic statistics.

## Boundaries and unit classification

Countries reuse `mundusCountryFeatures()` from the pinned Mundus country
builder, using its full-detail China point-of-view layer with Taiwan as its
own unit. No runtime country-name fuzzy matching is used. Administrative
boundaries are classified against this country view on a 43200×21600
30-arcsecond grid, using deterministic scanline filling with holes and
periodic longitude handling. Country-overlap area must be below `1e-6`.

For each country/admin-1 intersection:

1. A matching parent country keeps the administrative unit.
2. If at least 95% of an admin-1 polygon's rasterized area belongs to a
   different Mundus country, the entire unit transfers to that country.
3. Other pieces become remnants and join the receiving country's admin-1
   with the longest shared raster boundary.
4. A country with no represented admin-1 receives one whole-country fallback
   administrative unit. Ocean pixels keep label zero.

The generated `boundaryAdjustments` table records transfers and remnants,
their source and receiving units, area, coverage and review category. It
belongs to the manifest and to `boundary-adjustments.json`. The two arrays
must match exactly, and the asset's hash is verified before publication.
The snapshot is reviewed whenever it changes.
The map's boundary view is cartographic, not a legal statement on territorial
status. The manifest also records small countries or administrative features
that are not represented at the classification resolution.

English names come from the source features and the Mundus country view.
Existing Natural Earth `name_zh` values are used for Chinese names, with the
reviewed country-name table for whole-country fallbacks. English is the
display fallback where a Chinese admin-1 form is missing. China and Taiwan
admin-1 units require Chinese names. `nameCoverage` records admin-1 count,
Chinese count and fraction, direct Natural Earth count and fallback count;
absence of a translation is not claimed as complete name coverage.

## Aggregation and missing values

Source rasters and classification labels are read in row stripes. The full
global population raster is never loaded as one array. Geographic affine
coordinates, scale, offset and nodata metadata are preserved and checked.
The population file has a shifted 30-arcsecond affine grid and declares no
nodata; readers map its actual pixel centres rather than assuming aligned
global edges. Population and night lights use pixel-centre assignment.
Population alone can use the nearest classified land pixel within two label
pixels for a coastal source sample. Such assignments are counted explicitly.

Coarse GDP and CO₂ samples are divided between labelled land subpixels using
their spherical intersection areas. Ocean does not receive an administrative
share of a coarse sample; a sample with no labelled land remains unassigned.
Unassigned values and excluded Antarctic values remain in the conservation
accounting and do not become invented land observations.

An admin-1 unit with no valid assigned samples receives `null`. A valid sample
whose value is zero contributes a real zero. Each country's value is the sum
of valid child values; an all-missing child set remains missing. This creates
one consistent country/admin-1 snapshot. Compensated sums limit accumulated
floating-point error.

For every metric, the build requires
`sum(admin-1 values) + unassigned = valid source total` with relative error
below `1e-9`. Unassigned population must be below 0.5%. The global population
total must be within 2% of the 2020 scale of 7.8 billion, and the selected CO₂
total within 5% of the 2020 fossil-emission scale of 34.3 billion tonnes.
`aggregation` stores the measurements and inspected reader metadata;
`unassigned` stores each metric's fraction.

## Continuous deformation

The projection is cylindrical equal-area: horizontal position is longitude,
vertical position is `sin(latitude)`. Its area is proportional to spherical
area. The 2048×1024 spectral grid uses periodic horizontal boundaries
and reflecting vertical boundaries, implemented with a radix-2 FFT and
cell-centred DCT-II/III. The forward triangle mesh may be refined to 4096×2048;
`grid` identifies the spectral flow grid, while `materialMeshes` records the
actual country and admin-1 forward mesh dimensions when they differ. Exact
equal-area block averages let the finer material mesh use the smaller spectral
grid. Refinement changes representation,
not the acceptance thresholds or the maximum of six density corrections.

For each metric and statistical level, unit density is its value divided by
its true classified area. Mean density uses included units with data.
Oceans, Antarctica and missing units receive that mean density. Actual zero
uses a floor of 1% of mean density to keep the continuous map invertible.
The density field averages the exact area overlap of classified label
rectangles with each computational triangle. This retains small units rather
than selecting one label at a coarse cell centre. Any global normalization
needed for the zero floor is recorded in build diagnostics.

The production algorithm is Gastner, Seguy & More (2018),
[“Fast flow-based algorithm for creating density-equalizing map
projections”](https://doi.org/10.1073/pnas.1712674115). It uses a linear density
path to the mean and a time-independent flux computed in frequency space.
Gaussian blur reduces sharp density transitions; adaptive predictor/corrector
integration rejects steps with folded triangles. Bounded local damping can
halve the proposed displacement of vertices incident to a folded triangle;
periodic seam copies move together, and adjacent triangles are rechecked.
If this repair exceeds its vertex, work or displacement budget, the whole
step is rejected. Damping is a geometric approximation distinct from the
predictor/corrector integration error; measured unit areas, round trips and
encoded continuity still have to meet every acceptance bound. These checks can fail to
converge and do not guarantee a valid map. Further rounds reweight density in
the deformed space, with no more than six rounds. A correction can be integrated
directly along the existing material vertices: the spectral velocity is sampled
at their current deformed positions while connectivity and source coordinates
stay fixed. The alternative sampled-map composition path preserves positive
triangles before acceptance. A separate
analytic heat-diffusion solver exists for method tests; the publication
records the algorithm actually used for each map.

An optional positive-margin projection moves triangle vertices along the
signed-area gradient, rechecking the six incident triangles and periodic seam.
Unlike fold-only damping, it can act before an already positive triangle
collapses to floating-point resolution. Total displacement is measured against
the original proposed step and bounded independently of integration error;
an excessive correction rejects the step. This approximation has the same
scientific acceptance requirements as the other paths.

The optional offline C++ material integrator executes the same scalar formulas
in one thread. FFT/DCT and flux preparation remain in JavaScript. Its build
disables fast-math and fused floating-point contraction; small differential
cases compare complete coordinates, step acceptance, seams and deterministic
repeat outputs with the JavaScript path. Native executables and binary scratch
files stay in the external cache. This adds no browser dependency.

Each deformed grid cell is split into triangles. Barycentric rasterization
supplies inverse samples across the periodic seam. A Newton query uses that
raster as its seed; if it cannot converge in a compressed region, a spatial
index locates the actual positive forward triangle and computes its exact
barycentric inverse. The transmitted inverse is an adaptive quadtree of
bilinear displacement leaves, with periodic longitude and pole endpoints.
Adjacent leaves are balanced to a depth difference of at most one. A hanging
corner on a coarse edge takes the coarse endpoints' interpolated value, rather
than an independently fitted value. This makes the unquantized field continuous;
Int16 representation may leave a small residual edge jump. Every encoded edge
is checked separately and must remain below the 0.01° quantization bound.
Source-node round trips alone do not prove edge continuity. The browser samples this
field for both rendering and picking, including during the true-shape to
cartogram transition. Forward marker positions are recovered by solving the
inverse mapping with damped Newton steps. A failed local solve searches the
existing encoded leaves for a containing source quadrilateral as a seed; it
does not reconstruct a globe-sized CPU mesh. The selected point and previous
animation solution are cached only for that mapping. Result area ratios describe measured deformed area divided
by true classified area; they are not replaced by the target value ratio.

## Acceptance and asset budgets

All eight metric/level combinations must independently meet these bounds.
The publication manifest's `acceptance` keys are
`population-country`, `population-admin1`, `gdp-country`, `gdp-admin1`,
`co2-country`, `co2-admin1`, `lights-country` and `lights-admin1`. Each stores
the measured fields below, algorithm, iteration count and checked-unit count.
The manifest is the machine-readable authority for the published measurements.

| Measurement                                               | Required bound                         |
| --------------------------------------------------------- | -------------------------------------- |
| Forward triangle orientation                              | Every signed area strictly positive    |
| Unit-area relative error, units with world share ≥ `1e-4` | Median < 5%, p90 < 15%                 |
| Inverse after forward, great-circle angular error         | p99.9 < 0.05°, maximum < 0.5°          |
| Sum of deformed spherical area                            | Relative difference from `4π` < `1e-6` |
| Encoded inverse quantization error                        | Maximum < 0.01°                        |
| Encoded adaptive edge jump                                | Maximum < 0.01°, independently checked |
| Repeat build from identical inputs                        | Byte-identical assets                  |

| Asset                               | Format                                                                                     | Transfer budget     |
| ----------------------------------- | ------------------------------------------------------------------------------------------ | ------------------- |
| `units.json`                        | Unit id, level, parent, bilingual name, area, representative point, palette/raster ids     | ≤ 120 KiB gzip      |
| `values.json`                       | Four values, world shares and measured area ratios per unit, year/source metadata          | ≤ 150 KiB gzip      |
| `boundary-adjustments.json`         | Transfer and remnant assignments, identical to the manifest array                          | Recorded separately |
| `ids-country.png`, `ids-admin1.png` | 4096×2048, non-interlaced RGB8, id `R×65536 + G×256 + B`, zero ocean                       | ≤ 900 KiB each      |
| Country inverse fields ×4           | Adaptive quadtree; Uint32 nodes and Int16 four-corner displacement leaves, meshopt encoded | ≤ 4 MiB each        |
| Admin-1 inverse fields ×4           | Same adaptive encoding                                                                     | ≤ 8 MiB each        |

Metadata uses versioned `columns-shuffled-le` JSON: byte-shuffled little-endian
Float64 areas and administrative values are stored losslessly as base64.
Administrative codes use a lossless `prefix-base36` encoding. Country values
are compensated sums of children, and world shares are derived
from those values and the captured total. Representative points retain their
30-arcsecond classification pixel. Country English names reuse the full
Mundus country inventory; Chinese names join the same pinned Natural Earth
source by exact numeric ISO id, with the established China and Taiwan names.
The metadata includes all represented countries, including those absent from
the simplified display layer. Display area ratios use a log2 Uint16 encoding at scale 1024, whose
maximum relative quantization error is below 0.034%. This display precision
is separate from the unquantized unit-area acceptance measurement.

The inverse header uses `MRE2`, format version 2, metric/level, root dimensions,
maximum depth, `treeNodes`, `leafCount`, stride, each meshopt block's encoded
length, `verticalCoordinate: latitude`, and longitude/latitude quantization
steps. The adaptive grid is uniform in target longitude and latitude before
local refinement; its four-corner leaves encode longitude and latitude
displacements. This retains angular resolution near compressed poles and avoids
subtracting near-equal sine-latitude floats in the shader. Intermediate morphs
still interpolate sine-latitude, using a polar half-angle form; endpoints use
the sampled source latitude directly. The normal root grid is
128×64; 64×32 roots are also supported, with at most eight local subdivisions.
`MRE1` regular fields remain readable for compatibility. Manifest format stays
version 1; it is separate from the binary field's format version. Steps
are selected from actual maximum displacements. ID PNGs contain only IHDR,
IDAT and IEND, with valid CRCs; colour-profile chunks are rejected. Runtime
decoding reads raw ID bytes through `DecompressionStream('deflate')` without
canvas or browser colour management.

Both inverse fields that coexist during a morph, the active ID raster and the
palette must stay within a 40 MiB GPU budget. Uint32 tree and RGBA16I corner
textures include padding to 1024-wide rows, plus the regular placeholder.
The lossless GPU ID texture uses RG8 and occupies 16 MiB at full resolution;
the distributed PNG remains RGB8. Palette accounting includes its padded
RGBA32F rows. Low quality uses nearest-neighbour reduction of the ID
raster to 2048×1024. The lobby requests no Reshaped Earth code or data;
entering the observation loads metadata and only the active map assets.
Missing decompression or required graphics support keeps the semantic unit
list and values usable. A failed asset request exposes retry and preserves
the regular globe.

## Rebuilding and verifying

`pnpm data:reshaped` rebuilds classification, aggregation, coverage and all eight
fields from pinned sources, reusing only intermediates with the same input
fingerprint. It writes a complete candidate in the external cache and verifies
it before replacing published assets. `--rebuild` forces fields to be computed
again; `--phase=fields` stops before publication. Routine tests perform no
network download and do not establish production readiness.

```bash
pnpm data:reshaped --capture
pnpm data:reshaped
pnpm test:data-reshaped
pnpm data:verify
```

Capture is the explicit source-refresh step: inspect upstream filename,
version, licence, year and size, review its SHA-256, then pin the source
register. The production builder rejects unpinned or mismatched identities
and publishes only after aggregation, deformation and encoded-field acceptance
pass. The same verifier can inspect the complete candidate in place:

```bash
node scripts/verify-generated-data.mjs --reshaped-manifest /path/to/stage/manifest.json --reshaped-assets /path/to/stage
```

The candidate keeps canonical final paths in its manifest; only file reads are
redirected to the stage. Schema, hashes, raw and gzip sizes, metadata, conservation,
PNG IDs, inverse headers, encoded edge continuity and GPU budgets use the same
checks as published data. Publication retains the previous asset set in the
external cache for recovery.

Raw inputs and resumable intermediates are retained under
`${MUNDUS_DATA_CACHE:-$HOME/.cache/mundus-data}/reshaped-earth/`, outside the
worktree. Changing an upstream version or substituting another year is a
reviewed data change. Data refreshes must disclose storage and compute bounds
under the repository resource gate. Temporary cleanup moves files to Trash;
raw inputs, caches, reports and generated build directories are never committed.

## Limits of the observation

The cartogram communicates relative totals, not density at a specific street,
travel accessibility or a causal relation between quantities. Coastlines and
small islands are limited by classification and display raster resolution.
Subnational detail inherits the spatial modelling and resolution of each
source. A country with no Natural Earth admin-1 coverage uses a whole-country
fallback; a missing Chinese translation uses English. Saturated night lights,
unassigned offshore emissions, estimated PPP GDP and modelled population
remain explicit limitations. Geographic distances should be read in another
observation on the true globe, not measured from the deformed outline.
