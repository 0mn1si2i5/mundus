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
and coloured before averaging; near a boundary or selected ring it adds four
samples to stabilize the thin casing. Smaller footprints use one sample. The winning
score supplies the unsigned distance used to shade the boundary. Four same-label texels whose distances all saturate
at 4 pixels mark an interior lower bound, rather than a measured boundary;
they suppress border and selection ink so distant oceans stay dark when the
globe shrinks. A 1 CSS-pixel ink line has identical 0.75 CSS-pixel casing on both sides,
using `fwidth` antialiasing and the actual renderer DPR. Derivatives run before
label, patch and sampling branches so every fragment has defined derivatives.
Base and local rasters
share this shading path. Selection preserves the fill and adds a 3 CSS-pixel
emphasis ring, with ink and casing along its outer edge.

At GDP maximum zoom, the former Hong Kong/Pearl River coast showed enlarged
raster steps and dark wedges. A direct pixel-centre comparison against the
same 10m vectors found 11 ownership mismatches among 616 base pixels in
112.5–115° E, 21.5–23.5° N; all 11 have B=0. The publication distance builder
intentionally writes zero when the retained raster label differs from vector
ownership. Interpolating those zeros makes whole enlarged pixel regions look
like boundaries. Four-pixel truncation is already treated as an interior lower
bound and is not the cause of these zero-distance wedges.

A 45° geographic index uses 32 `uvec2` uniform bins (256 bytes), with one bit
per local rectangle. Empty bins bypass the rectangle scan; populated bins
retain the exact bbox and seam tests for every independent supersample. This
adds no texture or distributed asset.

The local atlas derives R and B from the same full vector geometry, at eight
times the base resolution, so it removes the ownership mismatch and enlarged
steps inside the selected local rectangles. The shader uses the actual local
pixel footprint, independent classification for each supersample, and the
specified colour blend at the two-base-pixel seam. It does not widen or blur
the boundary to hide this defect. Outside those rectangles, the frozen base
raster retains its existing coarse coastline at extreme magnification.

The parchment rectangle above the desktop result card was a Chromium
compositing defect involving its positioned scroll container: WebGL readback
at the affected pixel contained opaque map RGB (193, 204, 199), while the page
screenshot exposed the shell background. Removing the card's shadow did not
fix it; removing its scrolling did. Moving scrolling to an inner content box
preserves the bounded card and scrolling and restores the map above it.

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
| Population   | #08201e | #469b82 | #64d3cc | #fbf6ec   | #f89986 | #c5523c | #6e2e21 |
| GDP          | #49446e | #9e62c2 | #ada4ef | #f6f3ee   | #d4a541 | #8e6d16 | #544309 |
| CO₂          | #1b3340 | #3d8fb5 | #85c6eb | #f5f0e9   | #e4a275 | #a5693c | #663d1e |
| Night lights | #09456a | #5772a2 | #579eea | #9b9c9e   | #d59102 | #eebb77 | #fcf9f5 |

Population, GDP and CO₂ retain ocean `#c7d2cd`, graticule `#6b6258`, ambient
light 0.72 and directional light 0.30. Night lights use ocean `#0b1424`, cool
grey graticule `#718096`, ambient 0.72 and directional 0.18; band luminance
increases strictly. Country borders and coasts use one ink per theme:
warm brown `#241f18` for population, GDP and CO₂, and navy `#0b1424` for lights.
Casing is warm white `#fbf7ee` at 85% opacity, or cool grey `#9aa7b8` at
35% opacity for lights. The emphasis ring is `#e8562a`, or ice blue `#7fd3ff`
for lights.
All colour, ocean, graticule and lighting tokens transition together; reduced
motion applies them immediately, including in true shape. The page retains
its parchment appearance.

The smaller/larger CIELCh hue centres are population 180°/45° (teal/ochre
red), GDP 305°/80° (purple/gold), CO₂ 245°/60° (grey blue/smoky orange),
and lights 265°/80° (slate blue/amber to near white). Every side band stays
within 25° of its centre; neutral chroma is lower than every side band.
Parchment luminance increases toward the neutral band, then decreases;
night-light luminance increases throughout. Padding mixes 70% neutral
luminance and then 15% white in linear RGB before hatching.

Both adjacent bands and unhatched padding against both neighbouring bands
require ΔE00 ≥10 under full-severity Machado protan/deutan/tritan simulations.
Padding is also checked without simulation. Casing is composited in linear RGB
over all bands, padding and ocean before measuring contrast to ink: ≥3:1
on parchment, ≥2:1 at night. Emphasis/ink requires ≥3:1. These checks include
minimum and maximum shader lighting; antialiased edge pixels blend with their
background and are excluded.

`node scripts/check-reshaped-colors.mjs` reproduces the minimum values below;
Vitest runs the same contracts as part of `pnpm check:source`. D65
sRGB/Lab/CIEDE2000 math is checked against published CIEDE2000 reference pairs.

| Metric       | Max hue deviation | Adjacent CVD ΔE00 | Padding CVD ΔE00 | Padding plain ΔE00 | Lit casing/ink | Emphasis/ink |
| ------------ | ----------------: | ----------------: | ---------------: | -----------------: | -------------: | -----------: |
| Population   |           10.587° |            11.676 |           10.120 |             14.242 |       10.322:1 |      4.513:1 |
| GDP          |           10.447° |            15.318 |           13.544 |             13.911 |       10.407:1 |      4.513:1 |
| CO₂          |            0.813° |            15.871 |           11.468 |             12.715 |       10.354:1 |      4.513:1 |
| Night lights |           12.050° |            11.495 |           10.173 |             10.014 |        2.707:1 |     11.111:1 |

The darkest night-light band contrasts with ocean at 1.817:1 before lighting
and at least 1.609:1 under lighting, exceeding the 1.5:1 bound. These checks
do not measure physical-device calibration. Legends and ranking text also
describe each class.

Shares use `0%`, `<0.001%`, two significant digits below 10%, and one decimal
place from 10% upward. Area ratios use an integer from 10×, one decimal from
1× to 10×, two decimals below 1×, and a localized `about 1/N` form below
0.1×. The same functions format result facts, rankings and padding notes.

## High-resolution small-country patches

Countries with true classified area <20,000 km² and an `areaRatio` ≥10 in any
published metric receive a local ID/distance patch. The selection uses the
published effective area multipliers, not a new density or area solve. The
base ID raster, four inverse fields, forward maps, numerical acceptance and
padding-core choices are unchanged by these display patches.

Each country contributes all polygons from the full-precision Natural Earth
10m geometry. On each axis, a polygon's raw bounding box expands by
`max(10% of its span, 1 base pixel) + 2 base pixels`. The final 2 base pixels
form the transition band. Expanded rectangles from all selected countries
are clustered together, with longitude-periodic intersection tests and
repeated envelope merges until every final rectangle is disjoint. A block
can contain several countries, and one country's distant islands can occupy
several blocks. Merging keeps the existing expanded envelopes rather than
applying the margin again. The ≤64 limit is checked after global clustering.

Local pixels are 360/32768° on each axis, eight times finer than the base
raster. Geometry plus its 4-local-pixel distance-field extent must lie wholly
inside the inner edge of the transition band: the minimum clearance from
geometry to rectangle is 20 local pixels (16 transition + 4 distance).
Failure stops publication.
The builder records boundary pixels crossing the transition band and
base/local label disagreements there without imposing a zero-disagreement
gate: a nearby country's coast may cross the soft seam.

R comes from vector containment at local pixel centres, including neighbours
and ocean. B comes from the same vector segments, with longitude scaled by
cos(latitude), periodic longitude and the same 0–4 pixel truncation and
quantization as the base raster. Boundary segments immediately outside the
rectangle are included within the distance cap. G copies the nearest base
padding bits only when the local nonzero R agrees with that base R; ocean
and differently classified pixels receive zero, preventing a neighbour's
padding from being attributed to a small country. No new padding core is
computed. National `basePixelCount` and `basePaddingBits` are recorded from
the whole base raster, independently of any particular island block.

`ids-patches.png` is an RGB8 atlas with deterministic shelf packing and a
1-pixel copied edge around each block. `ids-patches.json` stores country and
raster ID lists, group and polygon membership, real-coordinate `bbox`, atlas
rectangle, inner/block dimensions, transition diagnostics, complete national
padding evidence, selection and budget-pruning records. Both files are
registered and hashed in the publication manifest.

For a sample inside a patch rectangle, the shader independently classifies
and shades the base and local raster with the same multi-label classifier,
including borders and padding. Within the 16-local-pixel transition band,
`smoothstep` mixes from base at the rectangle edge to local at the inner edge.
The interior uses local shading. CPU picking and restored point results use
local classification where that weight is ≥0.5, otherwise base classification.
Every supersample makes this rectangle choice independently. Atlas sampling
uses pixel centres and its actual dimensions; border widths remain in screen
pixels, with the footprint converted to local pixel units.

The atlas loads after the mode's first actual globe mesh draw. Until ready,
or after a load failure, the base raster remains usable. Success schedules
one redraw and updates picking; failure emits one console warning without
failing the mode. Atlas textures are released with the mode's other textures.

The current selection retains all 19 candidates; no budget pruning was needed.
Areas below are classified areas, not claims about legal territory.
Maximum multipliers span all four published metrics. CO₂ padding appears in
Palestine and Puerto Rico; all other candidate countries have no base padding.
Neighbouring countries inside a block can still have padding.

| Country             | Country ID | Raster ID |  Area km² | Maximum multiplier | Base pixels | National padding |
| ------------------- | ---------- | --------: | --------: | -----------------: | ----------: | ---------------- |
| Bahrain             | ne-048     |        14 |    685.86 |            182.53× |          11 | None             |
| Palestine           | ne-275     |        78 |  6,076.76 |             16.52× |          75 | CO₂              |
| Hong Kong           | ne-344     |        94 |  1,040.05 |            404.28× |          15 | None             |
| Kuwait              | ne-414     |       112 | 17,505.34 |             21.31× |         204 | None             |
| Lebanon             | ne-422     |       115 | 10,019.20 |             11.53× |         123 | None             |
| Liechtenstein       | ne-438     |       120 |    139.01 |             24.69× |           3 | None             |
| Luxembourg          | ne-442     |       122 |  2,597.68 |             24.79× |          42 | None             |
| Macao               | ne-446     |       123 |     31.01 |             64.42× |           0 | None             |
| Malta               | ne-470     |       129 |    328.90 |             24.09× |           3 | None             |
| Mauritius           | ne-480     |       131 |  2,021.77 |             10.07× |          23 | None             |
| Monaco              | ne-492     |       133 |     18.61 |             11.16× |           0 | None             |
| Puerto Rico         | ne-630     |       173 |  9,029.13 |             12.39× |          99 | CO₂              |
| Qatar               | ne-634     |       174 | 11,176.91 |             36.08× |         127 | None             |
| San Marino          | ne-674     |       186 |     60.59 |             14.36× |           1 | None             |
| Singapore           | ne-702     |       193 |    513.32 |            912.38× |           5 | None             |
| Trinidad and Tobago | ne-780     |       213 |  5,150.42 |             24.60× |          52 | None             |
| Guernsey            | ne-831     |       225 |     71.40 |             11.70× |           1 | None             |
| Jersey              | ne-832     |       226 |    117.77 |             12.35× |           1 | None             |
| Isle of Man         | ne-833     |       227 |    572.17 |             16.99× |          11 | None             |

The 17 blocks below include the copied 1-pixel edges in their dimensions.
Mauritius's three polygons in this pinned geometry form separate main-island,
Agalega and Rodrigues blocks. Cross-country blocks retain every vector label
inside them; their listed countries are the selected members.

| Group | Selected countries     | Block pixels | Transition boundary pixels | Label disagreements |
| ----: | ---------------------- | ------------ | -------------------------: | ------------------: |
|     0 | Bahrain, Qatar         | 163×214      |                      1,390 |                  17 |
|     1 | Palestine, Lebanon     | 275×374      |                        953 |                  19 |
|     2 | Hong Kong, Macao       | 131×92       |                      1,842 |                  23 |
|     3 | Kuwait                 | 242×205      |                        748 |                  14 |
|     4 | Liechtenstein          | 63×70        |                        488 |                   3 |
|     5 | Luxembourg             | 122×117      |                        703 |                   5 |
|     6 | Malta                  | 85×75        |                          0 |                   0 |
|     7 | Mauritius: main island | 95×99        |                          0 |                   0 |
|     8 | Mauritius: Agalega     | 55×58        |                          0 |                   0 |
|     9 | Mauritius: Rodrigues   | 65×59        |                          0 |                   0 |
|    10 | Monaco                 | 57×55        |                        580 |                   5 |
|    11 | Puerto Rico            | 296×105      |                         87 |                   3 |
|    12 | San Marino             | 60×59        |                        384 |                   5 |
|    13 | Singapore              | 84×67        |                      1,457 |                  43 |
|    14 | Trinidad and Tobago    | 180×170      |                      1,203 |                  30 |
|    15 | Guernsey, Jersey       | 111×101      |                        529 |                   8 |
|    16 | Isle of Man            | 94×83        |                        228 |                  24 |

If the encoded atlas exceeds 150,000 B gzip-6, candidates are removed in
descending base-pixel count, breaking ties by increasing country ID. Each
step re-clusters, packs and encodes the retained selection and records its
gzip size. Removed countries keep base-raster display. Publication stops
before removing Hong Kong, Macao, Singapore, Monaco, Bahrain or Malta, or if
the geometry guard, ≤64 blocks or ≤40 MiB GPU bounds fail. The published
`removals` list is empty; step 0 records 88,161 B gzip for all 17 blocks.

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
| `ids-patches.png`                                                | RGB8 local ID/padding/distance atlas; 8× resolution and ≤64 globally clustered blocks                | gzip-6 ≤150,000 B                           |
| `ids-patches.json`                                               | Selection, real-coordinate and atlas rectangles, diagnostics and pruning records                     | Loaded after first mesh draw                |
| `inverse-{population,gdp,co2,lights}.bin`                        | MRE3 uniform node pairs, meshopt                                                                     | Each gzip-6 ≤700,000 B and raw ≤1,200,000 B |
| Entering mode: metadata + default population inverse + ID raster | Actual asset gzip-6 sum                                                                              | ≤1,800,000 B                                |
| Morph GPU textures                                               | Two RG32F inverses, base RG8 IDs and R8 distances, one RGB8 patch atlas, and palette                 | ≤40 MiB                                     |

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
initial population data totals 1,720,407 B gzip-6. The later-loaded patch atlas
is 2048×433, 91,688 B raw / 88,161 B gzip-6; its metadata is 22,440 B raw /
4,058 B gzip-6. Full-resolution morph textures occupy 36,255,760 B
(34.58 MiB): 25,165,824 B for base RG8 IDs/padding plus R8 distances,
2,660,352 B for the patch atlas, 8,413,200 B for two RG32F inverses, and
16,384 B for the four-row RGBA32F palette. The atlas is excluded from the
first-screen transfer because it loads after the first mesh draw.

## Browser evidence (2026-10-11)

Maximum-zoom comparisons use the unchanged assets from `20a979d` on the left
and the local atlas on the right, with identical real-coordinate focus and
12 zoom-in key presses. They cover GDP Mauritius main island, Rodrigues,
Agalega, Bahrain, Singapore, Hong Kong, Macao, Malta and Luxembourg;
population West Africa, CO₂ Europe, night lights Southeast Asia, and a
night-light Hong Kong selection. Desktop and Pixel 7 emulation share the same
interaction path and use reduced motion.

| Evidence             | Desktop Chromium                                                                                  | Pixel 7 emulation                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Mauritius islands    | [Before / after](https://github.com/user-attachments/assets/6da7e182-e284-4a7f-97dc-df086a4fa830) | [Before / after](https://github.com/user-attachments/assets/15dda41e-a107-4b8c-861c-5de196ec150a) |
| Small countries      | [Before / after](https://github.com/user-attachments/assets/cd22a86a-4a52-4405-95e7-0cd8a2521915) | [Before / after](https://github.com/user-attachments/assets/cb814664-06a0-48c0-8ff2-f8190107545d) |
| Themes and selection | [Before / after](https://github.com/user-attachments/assets/783adf9d-0615-4d4c-9e28-fca78979250e) | [Before / after](https://github.com/user-attachments/assets/5cfb815d-b920-4a92-b854-5243f33d4f4d) |

At fixed camera focus on Germany, the same three 0°, 0.05° and 0.10° turns
were read from the actual WebGL framebuffer. Each channel records one label
sample; a complete label flip means none of the four labels are retained.
For the 0°→0.10° pair, border complete-flip pixels as a percentage of the full
viewport are:

| Device / shape     | `20a979d` | Local atlas |
| ------------------ | --------: | ----------: |
| Desktop / true     | 0.000868% |   0.000868% |
| Desktop / reshaped | 0.089952% |   0.089952% |
| Pixel 7 / true     |        0% |          0% |
| Pixel 7 / reshaped | 0.000926% |   0.000926% |

All three pairs retain or reduce complete flips. Fractional coverage changes
can increase slightly as local coastlines gain detail; for example Pixel 7
reshaped equivalent coverage changes from 0.097851% to 0.099379% in the
0°→0.10° pair. These are controlled evidence, not an unstable E2E threshold.

The existing production benchmark uses a 2-second warmup and 10-second sample.
These measurements use ANGLE/SwiftShader software rendering; they do not
measure a physical phone or hardware GPU. Desktop quality stays high; Pixel 7
starts with the normal low-quality profile.

| Device / observation     | Before p50 / p95 (ms) | After p50 / p95 (ms) |
| ------------------------ | --------------------: | -------------------: |
| Desktop / Other Side     |           96.6 / 99.4 |         95.9 / 104.7 |
| Desktop / Reshaped Earth |           80.2 / 85.8 |        121.7 / 132.6 |
| Pixel 7 / Other Side     |           31.7 / 34.2 |          31.6 / 33.4 |
| Pixel 7 / Reshaped Earth |           44.7 / 48.3 |          65.0 / 70.6 |

The local classifier increases software-renderer frame time. The geographic
bins limit the scan, and atlas arrival updates uniforms on the existing shader
program so it does not cause a second shader compilation. The atlas adds
2,660,352 texture bytes; the worst transition texture allocation remains
36,255,760 bytes (34.58 MiB), below 40 MiB.

Two independent production atlas builds produced identical PNG bytes
(SHA-256 `26e482d0c518251b1dbe8f97ef6e2787dd601c0416935c44b125bfec7a189b3d`)
and identical metadata, matching the published PNG. The frozen base PNG,
inverse fields and scientific acceptance are unchanged.

## Rebuild and verification

`pnpm data:reshaped --offline --phase=aggregate` freshly reads all four sources
and compares country totals. `--phase=fields` builds lights, CO₂, GDP, then
population, twice each. `--phase=publish` reuses accepted matching fields and
verifies a complete nine-asset candidate before replacing published data.
`--rebuild` forces complete field builds. `--metric=<id>` limits field work.
The input fingerprint binds pinned sources, fresh aggregates, classification,
coverage, algorithm parameters and numerical/decoder/sampler source hashes.

`pnpm data:verify` checks the committed manifest, hashes, gzip/raw budgets,
country metadata, conservation, PNG IDs, patch rectangles and diagnostics,
inverse headers and GPU budgets.
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
Coastlines, islands and small countries are limited by the classification,
pinned vector geometry and display grids. The patches improve visual
classification and borders for selected small countries; they do not change
the scientific grid or recover features absent from the pinned vectors.
Modelled population, PPP estimates, unassigned offshore emissions
and saturated night lights remain explicit limitations. Distances belong on
the true globe in another observation.
