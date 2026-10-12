# Reshaped Earth: country data and method

Reshaped Earth compares four country-level snapshots from 2020 by changing each
country's area on a cylindrical equal-area globe. A shared point keeps its real
longitude and latitude. Only a non-default `metric` is serialized in the URL;
shape progress is local and legacy `level` parameters are ignored. The runtime
publishes population, GDP, fossil CO₂ and relative night lights at country level.

## Sources, licences and missing values

Exact source URLs, retrieval dates, selections and SHA-256 identities are pinned
in `scripts/reshaped-earth/sources.mjs` and the generated manifest.

| Measure      | Snapshot                                        | Unit and licence                            |
| ------------ | ----------------------------------------------- | ------------------------------------------- |
| Population   | JRC GHS-POP R2023A V1-0, epoch 2020, WGS84 30″  | persons; CC BY 4.0                          |
| GDP          | Kummu et al. downscaled GDP v4, 2020 band       | 2021 international dollars (PPP); CC BY 4.0 |
| Fossil CO₂   | GCP-GridFED v2025.1, complete 2020 archive      | tonnes CO₂/year; CC BY 4.0                  |
| Night lights | Li, Zhou, Zhao & Zhao harmonized DMSP–VIIRS v10 | relative DN index; CC BY 4.0                |
| Boundaries   | Natural Earth 5.1.2 country and admin-1 inputs  | Public domain                               |

The GDP reader accepts exactly the described 2020 band and validates its affine
metadata. GridFED monthly oil, gas, coal and cement-calcination layers are summed
and converted to tonnes; bunkers, carbonation uptake and land-use change are
excluded. Night-light DN is a relative, saturated index, not radiance or income.
Population and GDP are modelled spatial estimates.

The existing Mundus country boundary policy is retained, including the reviewed
China/Taiwan forms. Administrative pieces are used only during the offline
classification and aggregation; 239 country records are published. Missing is
`null`, observed zero remains zero, and ocean, Antarctica and missing coverage
receive mean density. Antarctica is excluded from results. Country names are
joined by exact IDs with English and reviewed Chinese names; runtime fuzzy
matching is not used.

## Aggregation and acceptance

Source rasters are read in row stripes. Population and night lights use pixel
centres; coarse GDP and CO₂ cells are divided by spherical labelled subpixel
areas. Population may search a two-pixel coastline halo. Assigned plus unassigned
mass must equal valid source mass within `1e-9`; unassigned population is below
0.5%, population total is within 2% of 7.8 billion, and fossil CO₂ is within 5%
of 34.3 billion tonnes. Rebuilds compare every country with the accepted input;
missing transitions and relative differences at or above `1e-9` fail.

The cartogram uses the JavaScript Gastner–Seguy–More (2018) method. Density is
country value divided by true classified area. The 2048×1024 grid is periodic in
longitude and reflecting at the poles. FFT/DCT flux preparation, a linear density
path, adaptive predictor/corrector integration, positive-triangle checks and
bounded mapped-space correction are all part of the offline build. The reviewed
blur schedule is `[32,16,8,4,2,1,0.5,0.25]`; a field stops on raw acceptance,
three consecutive p90 improvements below 0.5 percentage points, or 16 rounds.
Raw and final acceptance require median area error <5% and p90 <15% among
nonmissing, nonexcluded countries with at least 0.01% of the measure's total.
After padding, solid-core area is used for padded countries and actual area for
the others. Only GDP may be omitted on failure; population, CO₂ or night-light
failure stops publication.

The inverse is a 1024×512 cell grid with 1025×513 periodic nodes. MRE3 stores
Int16 longitude and sine-latitude deltas with meshopt compression. Runtime accepts
only the validated MRE3 header and rejects prototype formats. Fifteen reviewed
quantization choices are tested; the smallest gzip-6 candidate meeting source,
display and raw-file limits is selected. CPU picking, markers and GLSL use the
same node-aligned bilinear interpolation and pole conventions.
The source quantization error must be <0.01°; 400,000 fixed-seed equal-area
display samples must have p99 ≤0.1° and p99.9 ≤0.5°. Maximum display error is
recorded rather than hidden: extreme small-country tails can exceed 3°.

## Padding and local atlas

After raw iteration, a metric pads a country when transformed area `A` exceeds
`1.10 × T`, where `T` is its target, unless the 4096×2048 raster has fewer than
64 pixels. Pixels are sorted by spherical eight-neighbour distance from the
vector boundary. The deepest pixels whose accumulated transformed area reaches
`T` are the solid core; the remaining boundary ring is hatched padding. The core
is used for the displayed area ratio, while the raster integral remains recorded
for audit. `values.json` is the only per-country padding record; the manifest
stores counts, maxima, area-error bounds and a SHA-256 over those records.

`ids-country.png` stores country ID in R, stable metric padding bits in G
(population 0, GDP 1, CO₂ 2, lights 3), and vector-boundary distance in B. Ocean
has ID 0 and no padding. The shader desaturates padding and draws diagonal
stripes in globe coordinates; hatching fades in during reshaping and metric
transitions and is absent in true shape. The legend, result panel and ranking
mark padding and report its approximate fraction. The local atlas is derived
from the same vector geometry and is checked for geographic and packed-rectangle
overlap; it has at most 64 blocks, a 150 KB gzip budget and the same GPU budget.

Local candidates have true classified area <20,000 km² and at least one
published area multiplier ≥10×. Their polygon boxes use 8× the base angular
resolution, expanded by `max(10% of axis span, one base pixel)` and a two-base-
pixel transition band. Overlapping expanded envelopes are clustered across
countries and islands until globally disjoint; distant islands may use separate
blocks. The 64-block limit applies after clustering. If gzip exceeds the budget,
larger candidates are removed first; Hong Kong, Macao, Singapore, Monaco, Bahrain
and Malta are protected. The accepted atlas retains all 19 candidates in 17 blocks.
The base/local colour blend uses a 16-local-pixel smoothstep band; CPU picking
uses local classification at weight ≥0.5. The atlas loads after the first mesh
draw; loading or failure retains the base map, and leaving the mode releases it.

## Rendering and colour contract

The CPU and GLSL classifier score the four surrounding texels with raw distance
bytes and choose the same label, including ocean. Four rotated samples are used
for a large screen footprint; near a boundary or selected ring four additional
samples stabilize the casing. Interior distance saturation suppresses false
borders. Country borders use one dark ink with a symmetric light casing: warm
brown `#241f18` and warm white `#fbf7ee` at 85% on parchment, navy `#0b1424`
and cool grey `#9aa7b8` at 35% for night lights. Selection adds an orange
`#e8562a` or ice-blue `#7fd3ff` ring. Ink is about 1 screen pixel, casing is
about 0.75 pixels on each side, and selection is about 3 pixels; derivative-
based antialiasing preserves these widths for base and local maps.

| Measure      | ≤0.1×     | ≤0.25×    | ≤0.5×     | around 1× | ≥2×       | ≥4×       | ≥10×      |
| ------------ | --------- | --------- | --------- | --------- | --------- | --------- | --------- |
| Population   | `#08201e` | `#469b82` | `#64d3cc` | `#fbf6ec` | `#f89986` | `#c5523c` | `#6e2e21` |
| GDP          | `#49446e` | `#9e62c2` | `#ada4ef` | `#f6f3ee` | `#d4a541` | `#8e6d16` | `#544309` |
| CO₂          | `#1b3340` | `#3d8fb5` | `#85c6eb` | `#f5f0e9` | `#e4a275` | `#a5693c` | `#663d1e` |
| Night lights | `#09456a` | `#5772a2` | `#579eea` | `#9b9c9e` | `#d59102` | `#eebb77` | `#fcf9f5` |

The seven bands are centred on 1×. Population uses teal/ochre-red, GDP
purple/gold, CO₂ grey-blue/smoky-orange, and night lights slate-blue through
amber to near-white. Same-side CIELCh hue deviation is at most 25°; adjacent
bands and padding pass ΔE00 ≥10 under the reviewed colour-blind simulations.
Composited casing contrast is at least 3:1 on parchment and 2:1 for night
lights; emphasis contrast is at least 3:1. `node scripts/check-reshaped-colors.mjs`
checks these contracts and runs through `test:data-reshaped`.

| Measure      | Max hue deviation | Min simulated adjacent ΔE00 | Min padding ΔE00 | Min casing/ink | Emphasis/ink |
| ------------ | ----------------: | --------------------------: | ---------------: | -------------: | -----------: |
| Population   |           10.588° |                      11.676 |           10.120 |       13.144:1 |      4.513:1 |
| GDP          |           10.448° |                      15.318 |           13.544 |       13.255:1 |      4.513:1 |
| CO₂          |            0.813° |                      15.871 |           11.468 |       13.186:1 |      4.513:1 |
| Night lights |           12.051° |                      11.495 |           10.014 |        3.289:1 |     11.111:1 |

Padding minima include normal vision and all three simulations; casing minima
include land, padding and ocean. Lit casing minima are 10.322:1 on parchment
and 2.707:1 for night lights. Night-light darkest-land/ocean contrast is 1.817:1
(1.609:1 under lighting), above 1.5:1. These are token and lighting checks,
not physical-display calibration.

## Final measured acceptance and budgets

| Measure      | Raw median/p90     | Effective median/p90 | Minimum triangle area | Display p99/p99.9 | Max quantization | Rounds / padding countries |
| ------------ | ------------------ | -------------------- | --------------------: | ----------------- | ---------------: | -------------------------- |
| Population   | 0.3449% / 4.3654%  | 0.2821% / 2.9806%    |             1.136e-11 | 0.0230° / 0.1949° |         0.00768° | 6 / 16                     |
| GDP          | 0.9275% / 13.9086% | 0.7348% / 6.4697%    |             4.516e-12 | 0.0312° / 0.1392° |         0.00887° | 12 / 28                    |
| CO₂          | 0.7412% / 11.3569% | 0.4491% / 7.6319%    |             4.478e-12 | 0.0290° / 0.1671° |         0.00926° | 8 / 40                     |
| Night lights | 0.4726% / 4.5932%  | 0.2928% / 3.0945%    |             3.523e-12 | 0.0142° / 0.0629° |         0.00923° | 6 / 29                     |

All four fields retain positive triangles, total-area error below `1e-9`, and
two byte-identical builds. The country ID raster is ≤1.2 MB gzip; the local
atlas is 88,161 bytes gzip; inverse fields are 436–504 KB gzip. The largest
simultaneous inverse transition plus ID textures and palette is about 34.6 MiB,
under the 40 MiB GPU limit. The initial population payload is about 1.72 MB.
All fields stopped on raw acceptance. Exact values, hashes and acceptance
parameters remain in the generated manifest; detailed aggregation metadata and
skipped padding countries remain in the accepted build cache.

## Rebuild and limits

Use Node 22 and pnpm 11.7. The ordinary source gate is `pnpm check:source`.
`pnpm data:reshaped --offline --phase=publish` only repackages the accepted
`~/.cache/mundus-data/reshaped-earth/country-v4` fields and fails on a missing,
stale or non-deterministic cache. `all`, `units`, `aggregate`, `coverage` and
`fields` are the rebuilding phases. Raw downloads and large caches stay outside
the repository; follow the repository resource gate before starting unknown or
machine-intensive work.

Limits and caveats: the exhibit is educational, not a legal boundary, census,
transport or navigation product. Extreme zoom can still expose the frozen base
raster's coastline resolution outside local atlas rectangles. Software-GPU
measurements and simulated mobile viewports do not establish physical-device
performance; the final evidence records this boundary.
