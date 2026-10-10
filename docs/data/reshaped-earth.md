# Reshaped Earth: country data and method

Reshaped Earth compares four **2020** country totals by continuously changing
country areas on the globe. The shared point keeps its real longitude and
latitude. Only `metric` enters the URL; shape progress remains local and old
`level` parameters are ignored. Admin-1 is reserved for a separate proposal.
Globe colours use the same area multiplier as the cartogram, with a diverging
seven-band scale centred on 1×; night lights use a dark-earth theme.

## Sources and interpretation

Source identities, retrieval dates and SHA-256 hashes are pinned in
`scripts/reshaped-earth/sources.mjs` and the publication manifest. Sources and
licences were checked on 2026-10-10.

| Quantity     | Pinned snapshot                                                                                                                      | Unit and terms                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Population   | European Commission JRC GHS-POP R2023A V1-0, epoch 2020, WGS84 30″                                                                   | Persons; CC BY 4.0                              |
| GDP          | Kummu et al. global downscaled GDP grids v4, Zenodo 18429133; `rast_gdpTot_1990_2024_5arcmin.tif`, description identifying band 2020 | **2021 international dollars (PPP)**; CC BY 4.0 |
| CO₂          | Jones et al. GCP-GridFED v2025.1, complete UEA 2020 archive                                                                          | Tonnes CO₂/year; CC BY 4.0                      |
| Night lights | Li, Zhou, Zhao & Zhao, harmonized DMSP–VIIRS NTL v10, figshare 9828827; `Harmonized_DN_NTL_2020_simVIIRS.tif`                        | Sum of relative DN 0–63; CC BY 4.0              |
| Boundaries   | Natural Earth 5.1.2 1:10m country China/default views and admin-1 classification input                                               | Public domain                                   |

The GDP reader requires exactly one band description identifying 2020 and
checks its affine grid and metadata. This v4 uses 2021 international dollars.
GridFED dimensions, coordinates, year and units are checked before reading.
Twelve monthly oil, gas, coal and cement-calcination layers are summed and
converted from kilograms to tonnes. International aviation and shipping
bunkers and cement-carbonation uptake are excluded. This is a fossil CO₂
snapshot, not a territorial all-gas inventory; land-use change is excluded.
Night-light DN is a harmonized relative index with saturation at 63. Its sum
is not radiance, electricity consumption or income. Population and GDP are
modelled spatial estimates.

## Classification and aggregation

The country view reuses full-detail `mundusCountryFeatures()` and the existing
Mundus China boundary policy, with Taiwan as its own unit. Boundaries are
cartographic, not a legal authority. The retained 43200×21600 classification
uses administrative pieces internally to preserve the already verified coastal
assignment and country totals. Each piece has a fixed Mundus country parent.
Only the 239 country records are published: no administrative names, results,
ID raster or boundary-adjustment table is distributed.

Raw rasters and labels are read in row stripes. Population and night lights
use actual geographic pixel centres. The shifted GHS-POP grid is preserved;
population alone can search within two classification pixels for coastal land.
Coarse GDP and CO₂ samples are divided among labelled land subpixels by their
spherical intersection areas. Offshore samples with no land remain unassigned.
Compensated sums form country totals from the internal pieces. An all-missing
country stays `null`; observed zero stays zero. Antarctica is excluded.

Every source is freshly aggregated before publication and compared country by
country with the earlier verified snapshot, with relative difference < `1e-9`.
A zero or missing transition fails that comparison. Conservation requires
assigned plus unassigned totals to match valid source totals within `1e-9`;
unassigned population is <0.5%. Population must be within 2% of 7.8 billion,
and included fossil CO₂ within 5% of 34.3 billion tonnes. The manifest records
reader metadata, conservation and unassigned fractions.

Country English names retain Mundus wording. Chinese names join the pinned
Natural Earth country source by exact IDs, with established “中国” and “台湾”
forms. All 239 country records require both names. No runtime name matching is
used. Country metadata uses lossless JSON numbers; displayed area ratios are
effective transformed area divided by true classified area (the solid core
for padded countries, otherwise the actual transformed area).

## Continuous cartogram and transmitted inverse

The projection is cylindrical equal-area: x is longitude, y is normalized
sine latitude. The 2048×1024 grid is periodic in x and reflecting at the poles.
Production uses the JavaScript implementation of Gastner, Seguy & More
([2018](https://doi.org/10.1073/pnas.1712674115)), with FFT/DCT flux preparation,
a linear density path and adaptive predictor/corrector integration. Density is
country value divided by true area. Ocean, Antarctica and missing countries
receive mean density; observed zero uses 1% of that mean to retain invertibility.

The common blur schedule is `[32,16,8,4,2,1,0.5,0.25]` grid cells, with
`0.25` retained from round 9 through the maximum of 16 rounds. Each round
evaluates raw country areas before padding. Iteration stops as soon as median
error is <5% and p90 <15%, after three consecutive p90 improvements of less
than 0.005 (0.5 percentage points), or at round 16. The checkpoint records
the ten largest signed country errors, their names and world shares.
Residual density is conservatively transported into the mapped
space; composition preserves positive triangles and applies bounded mesh
regularization (minimum Jacobian 0.001, eight passes). Measured area checks
remain mandatory after these approximations. Native integration, material-mesh
repair and adaptive inverse encoding are outside this publication.

Positive forward triangles are rasterized with barycentric interpolation onto
**1024×512 cells / 1025×513 nodes**, including the periodic seam. Nodes store
Int16 delta longitude in degrees and delta sine latitude; meshopt
`encodeVertexBuffer` compresses the pairs. The binary header uses magic `MRE3`,
format version 3, metric, cell dimensions, stride, payload size and both
quantization steps. Runtime reads only MRE3. Country metadata uses format version 4; the country-ID distance layout
and manifest use format version 5; old prototype metadata and ID layouts are
rejected rather than interpreted. PNG keeps the standard RGB8 IHDR, with
its application layout/version specified by the manifest.

Quantization is selected automatically from 15 reviewed combinations. Base
steps are maximum absolute displacement /32767 (minimum `1e-9` degrees and
`1e-12` sine latitude). Longitude multiples are `[2,4,8,16,24]`; sine-latitude
multiples are `[1,1.25,1.5]`. Select the smallest gzip-6 candidate that passes
all precision and raw/gzip size bounds. Ties use raw size, longitude multiple,
then sine multiple. The manifest records the rule, chosen factors and steps.

Rendering and CPU picking share node-aligned bilinear interpolation, longitude
unwrapping and pole conventions. Markers solve the same transmitted inverse
with damped Newton iteration. During a shape change, both endpoints use that
mapping. A failed asset has a retry path; unsupported graphics keeps the
semantic country list and values available.

## Incompressible-area padding

After the raw-area iteration stops, every metric applies the same rule. A
country whose actual transformed area A exceeds 1.10 times its target T
receives padding, unless its published 4096×2048 ID raster has fewer than
64 pixels. Skipped countries are listed in the manifest. Missing countries
and Antarctica receive no padding; undersized countries receive no correction.

An eight-neighbour spherical chamfer distance transform measures depth from
the country's boundary in real coordinates. Horizontal edges are scaled by
cos(latitude), diagonals combine that scale with latitude distance, and
longitude is periodic. Boundary pixels start at distance zero. Pixels are
sorted deepest first, breaking equal-distance ties by increasing linear pixel
index. Each pixel's spherical area is multiplied by the Jacobian of the
2048×1024 forward-grid triangle containing its centre, as in the raw area
measurement. Accumulation ends at the first pixel that reaches T; those pixels
form the solid core, and the remaining boundary ring forms the padding.

Core area differs from T by at most the final included pixel's area. The
manifest records that relative quantization bound, the fine-coverage actual
area, the published-raster integral, the core and the excess fraction
`(A - core)/A`. The raster integral is retained separately because the coarse
display raster and fine classification have different coastline resolution.
Acceptance uses core area for padded countries and raw actual area otherwise;
the original raw median and p90 remain visible alongside the effective errors.

`ids-country.png` stores country ID in R, padding bits in G, and the quantised
distance to the nearest vector boundary in B. B stores `round(clamp(d,0,4) ×
63.75)` where d is measured in display-raster pixels from the full precision
10m vector geometry, using cos(latitude) for longitude and periodic seam
handling. ID 0 (ocean) is also a boundary label. A pixel whose raster ID does
not agree with vector containment gets distance zero. Stable metric bits are
population 0, GDP 1, CO₂ 2 and night lights 3; a withheld metric's bit stays
empty. The shader
desaturates padding and overlays antialiased diagonal stripes generated in
the deformed globe's coordinates. Their strength follows shape progress and
the transition between metrics, so the true shape has no hatching. Picking
the ring selects the same country. A bilingual legend, a percentage in the
result and readable ranking labels explain that the continuous reshaping
could not remove this excess area.

## Boundary sampling and globe colours

For the four texels around a source UV, each distinct label c gets score
`m(c) = Σ weight(k) × (id(k) == c ? d(k) : −d(k))`. The largest score chooses
the label, including ocean. Padding bits come from the highest-weight texel
belonging to that selected label; bitmasks are never interpolated numerically.
The CPU picker and production GLSL compare weighted raw B bytes before
converting the winning score to pixels. This preserves the same first-candidate
tie rule without normalized-distance rounding reversing a tied coast label.
Longitude wraps; latitude clamps at the pole rows. A screen footprint larger
than one raster pixel uses four rotated samples, each independently classified
and coloured before averaging. Smaller footprints use one sample. The border
uses the winning score divided by the screen footprint and an antialiased
approximately 1.2 px line. Four same-label texels whose distances all saturate
at 4 pixels mark an interior lower bound, rather than a measured boundary;
they suppress border and selection ink so distant oceans stay dark when the
globe shrinks. Selection adds a 3 px outline and preserves the country's band
colour.

The seven shared bands have exact bounds `r ≤ 0.1`, `0.1 < r ≤ 0.25`,
`0.25 < r ≤ 0.5`, `0.5 < r < 2`, `2 ≤ r < 4`, `4 ≤ r < 10`, and `r ≥ 10`.
Here r is the existing published `areaRatio`: effective transformed area divided
by true classified area, approximating the intended density multiplier within
the recorded area error. The solid core supplies effective area for padded
countries. True shape uses the same classes. Missing values use `#a9a7a0`
and excluded Antarctica uses `#d4d0c5`. True observed zero uses the first band
and retains its explicit zero-value caveat.

| Metric       | ≤0.1×   | ≤0.25×  | ≤0.5×   | Around 1× | ≥2×     | ≥4×     | ≥10×    |
| ------------ | ------- | ------- | ------- | --------- | ------- | ------- | ------- |
| Population   | #1f6f78 | #4f9a9f | #93c3c2 | #e8dfc8   | #e3a67f | #c8673f | #8f3b22 |
| GDP          | #5b418f | #8973b4 | #c6bcd2 | #eef4ce   | #e6c66d | #c9982c | #8c6118 |
| CO₂          | #465773 | #7290a7 | #b3c5db | #f1dbdc   | #d9a77c | #b16e38 | #6d411e |
| Night lights | #31424f | #455f7a | #768fb2 | #a39595   | #bfad39 | #f1ba89 | #ffefc6 |

Population, GDP and CO₂ retain ocean `#c7d2cd`, graticule `#6b6258`, ambient
light 0.72 and directional light 0.30. Night lights use ocean `#0b1424`, cool
grey graticule `#718096`, ambient 0.72 and directional 0.18; band luminance
increases strictly. Selection ink is `#6b261c`, or ice blue `#bdeaff` for lights.
All colour, ocean, graticule and lighting tokens transition together; reduced
motion applies them immediately, including in true shape. The page retains
its parchment appearance.

One fixed border ink cannot maintain 3:1 against both palette extremes. Each
side instead uses white below linear luminance 0.179, otherwise black. Padding
mixes 70% neutral luminance and then 15% white in linear RGB before hatching.
The checks below measure unhatched padding against both adjacent bands, and
opaque border centres after the minimum/maximum sphere lighting. Antialiased
edge pixels intentionally blend with the surface.

`node scripts/check-reshaped-colors.mjs` reproduces the following minimum
values, using dependency-free D65 sRGB/Lab/CIEDE2000 and full-severity Machado
protan/deutan/tritan simulations in linear RGB. Unit tests include published
CIEDE2000 reference pairs as well as the palette acceptance bounds.

| Metric       | Protan ΔE00 | Deutan ΔE00 | Tritan ΔE00 | Padding ΔE00 | Border contrast after lighting |
| ------------ | ----------: | ----------: | ----------: | -----------: | -----------------------------: |
| Population   |      12.695 |      13.536 |      14.040 |       11.378 |                        4.217:1 |
| GDP          |      12.798 |      11.168 |      12.208 |       11.052 |                        4.006:1 |
| CO₂          |      12.281 |      15.880 |      16.530 |       10.215 |                        3.993:1 |
| Night lights |      11.541 |      10.429 |      10.531 |       10.101 |                        4.846:1 |

The darkest night-light band contrasts with ocean at 1.775:1 before lighting,
and 1.578–1.706:1 across the actual sphere-light range, above 1.5:1. These
checks validate the tokens and shader's linear lighting, not a physical-device
colour calibration. Legends and ranking text also describe each class.

Shares use `0%`, `<0.001%`, two significant digits below 10%, and one decimal
place from 10% upward. Area ratios use an integer from 10×, one decimal from
1× to 10×, two decimals below 1×, and a localized `about 1/N` form below
0.1×. The same functions format result facts, rankings and padding notes.

## Acceptance and budgets

For each field, ≥400,000 seeded points q are sampled uniformly in display x
and sine latitude, hence uniformly by spherical area. Angular error is measured
between `forward(inverse_shipped(q))` and q. `inverse_shipped` uses the actual
runtime decoder and sampler. A separate source-space comparison checks
quantization at every inverse node and the display samples.

| Measurement                                        | Required bound                               |
| -------------------------------------------------- | -------------------------------------------- |
| Forward signed triangle areas                      | All strictly positive                        |
| Effective country-area error, world share ≥ `1e-4` | Median <5%, p90 <15%                         |
| Display-space angular error                        | p99 ≤0.1°, p99.9 ≤0.5°                       |
| Sum of transformed spherical area                  | Relative difference from `4π` <`1e-6`        |
| Source-space quantization angular error            | Maximum <0.01°                               |
| Two complete builds from identical inputs          | Forward, inverse and padding bytes identical |

Measured values for all four fields, including p50/max angular errors, are
stored in the manifest's `acceptance`, `parameters` and `determinism` records.

| Quantity     | Rounds / stop | Raw median / p90 | Effective median / p90 | Padded countries | Maximum padding fraction |
| ------------ | ------------- | ---------------- | ---------------------- | ---------------- | ------------------------ |
| Population   | 6 / raw pass  | 0.345% / 4.365%  | 0.282% / 2.981%        | 16               | 97.972%                  |
| GDP          | 12 / raw pass | 0.927% / 13.909% | 0.735% / 6.470%        | 28               | 91.415%                  |
| CO₂          | 8 / raw pass  | 0.741% / 11.357% | 0.449% / 7.632%        | 40               | 97.735%                  |
| Night lights | 6 / raw pass  | 0.473% / 4.593%  | 0.293% / 3.094%        | 29               | 97.973%                  |

| Asset                                                            | Format                                                                                               | Budget                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `units.json` + `values.json`                                     | 239 country records, four values/shares/area ratios, bilingual names and source/year metadata        | Combined gzip-6 ≤60,000 B                   |
| `ids-country.png`                                                | 4096×2048 RGB8; R=country ID, G=metric padding bits, B=quantised 0–4 px boundary distance; R=0 ocean | gzip-6 ≤1,200,000 B                         |
| `inverse-{population,gdp,co2,lights}.bin`                        | MRE3 uniform node pairs, meshopt                                                                     | Each gzip-6 ≤700,000 B and raw ≤1,200,000 B |
| Entering mode: metadata + default population inverse + ID raster | Actual asset gzip-6 sum                                                                              | ≤1,800,000 B                                |
| Morph GPU textures                                               | Two RG32F inverse textures, RG8 IDs, R8 distance and palette                                         | ≤40 MiB                                     |

Transfer budgets use gzip level 6. The GitHub Pages host was checked to return
`content-encoding: gzip` for the existing `application/octet-stream` vector
asset; raw-file bounds remain independently enforced. PNG decoding checks CRCs
and reads raw RGB bytes without canvas colour management. Low quality takes every other ID/padding texel and scales its distance by
one half. Country selection then uses the same bilinear classifier. The lobby requests no mode code
or data; entering requests only the active metric inverse.

The owner approved the ID-raster cap of 1,200,000 B on 2026-10-11 because the
complete ocean/land vector distance field cannot fit the earlier 900,000 B
cap losslessly. The initial population transfer cap remains 1,800,000 B.
The PNG uses deterministic Sub row filtering and filtered deflate; decoded
R/G bytes, four inverse fields and all scientific acceptance records remain
unchanged. The published PNG is 1,182,541 B raw / 1,162,743 B gzip-6;
initial population data totals 1,720,407 B gzip-6. Full-resolution morph textures occupy 33,595,408 B (32.04 MiB):
25,165,824 B for RG8 IDs/padding plus R8 distances, 8,413,200 B for two
RG32F inverses, and 16,384 B for the four-row RGBA32F palette.

## Rebuild and verification

`pnpm data:reshaped --offline --phase=aggregate` freshly reads all four sources
and compares country totals. `--phase=fields` builds lights, CO₂, GDP, then
population, twice each. `--phase=publish` reuses accepted matching fields and
verifies a complete seven-asset candidate before replacing published data.
`--rebuild` forces complete field builds. `--metric=<id>` limits field work.
The input fingerprint binds pinned sources, fresh aggregates, classification,
coverage, algorithm parameters and numerical/decoder/sampler source hashes.

`pnpm data:verify` checks the committed manifest, hashes, gzip/raw budgets,
country metadata, conservation, PNG IDs, inverse headers and GPU budgets.
It performs no raw-source download or production solve. A candidate can be
checked in place:

```bash
node scripts/verify-generated-data.mjs --reshaped-manifest /path/to/stage/manifest.json --reshaped-assets /path/to/stage
```

Raw sources, classification, forward checkpoints, numerical reports and
previous generated directories remain under
`${MUNDUS_DATA_CACHE:-$HOME/.cache/mundus-data}/reshaped-earth/`. Publication
retains the previous asset set for recovery. Refreshing a source or accepting a
licence change requires owner review. Resource-heavy rebuilds follow the
repository resource gate; routine checks never perform them.

## Limits

This exhibit communicates country totals and their relative area. It cannot
show street-level density, travel accessibility or a causal relationship.
Coastlines, islands and small countries are limited by the classification and
display grids. Modelled population, PPP estimates, unassigned offshore emissions
and saturated night lights remain explicit limitations. Distances belong on
the true globe in another observation.
