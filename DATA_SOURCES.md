# Data sources

Mundus keeps machine-readable source records under `src/data/manifests/` and
verifies committed derived snapshots with `pnpm data:verify`. Raw downloads are
not committed. The code license does not replace any data license described
below.

Where the product shows attribution: every notice below appears in the
**About** dialog (header button "关于" / "About"), which is always one click
away, and the desktop layout keeps a compact credit line ("Data: Natural Earth
· GeoNames · community surname data · GHSL") on screen with a link to it.

## Mundus country boundaries (Natural Earth), low and high detail

- Source: [Natural Earth Admin 0 – Countries, 1:10m](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/),
  version 5.1.2: the China point-of-view layer
  (`ne_10m_admin_0_countries_chn`) plus the default layer
  (`ne_10m_admin_0_countries`), both pinned by SHA-256
- Terms: [public domain](https://www.naturalearthdata.com/about/terms-of-use/); redistribution allowed
- Use: every observation's country geometry, country/ocean picking, borders,
  labels, and the vector globe
- Boundary view: Mundus draws boundaries from the China point of view, except
  that Taiwan is kept as its own unit (its islands are removed from China and
  Taiwan is taken from the default layer). Areas the default layer splits off
  under de facto control (for example Kosovo, Northern Cyprus, Somaliland, and
  Siachen) therefore belong to the unit the China view assigns them to.
  English unit names follow the default layer so wording does not change with
  the boundary view.
- Identifiers: `ne-` plus the ISO 3166-1 numeric code (`ISO_N3_EH`); units that
  share or lack a code are merged into their sovereign (Australian and British
  external territories, Clipperton, the Brazilian Island, Scarborough Shoal),
  and Bir Tawil keeps the explicit id `ne-x-bir-tawil`
- Transformation (`pnpm data:countries`): build one shared-arc topology,
  simplify by spherical Visvalingam area (4% of vertices at low detail, 17% at
  high detail), drop unpopulated islets below a size threshold while keeping
  each unit's largest polygon and every islet holding a GeoNames major city,
  fill small holes together with their enclaves, restore full detail wherever
  simplification would make a ring cross itself, and quantize to 10⁶ steps.
  Low detail keeps the reviewed 174-unit inventory of the former 1:110m
  distribution; high detail keeps all 239 units.
- Attribution shown in the product: **Made with Natural Earth**

Source hashes, output hashes, sizes, and vertex counts are recorded in
`src/data/manifests/mundus-countries.json`. Of the 6,953 GeoNames major cities,
both details place more on land than the former `world-atlas` 1:110m and 1:50m
files did. Boundaries are a cartographic view and are not a legal authority on
territorial status.

## Natural Earth vector globe, 1:110m and 1:50m

- Source: the Mundus country boundaries above, at low (110m) and high (50m)
  detail
- Terms: public domain; redistribution allowed
- Quality policy: low quality lazily requests 110m; medium and high quality
  lazily request 50m; the existing raster sphere remains visible while loading
  or after a vector failure
- Transformation: classify rings by projected area and containment, triangulate
  each Polygon/MultiPolygon part and holes in a local gnomonic projection,
  subdivide edges on the sphere, reject
  degenerate/outside slivers, merge every country into one surface buffer, and
  derive one coastline plus one internal shared-boundary buffer from TopoJSON
  topology
- Encoding: signed-normalized 16-bit positions, stable `countryIndex`, and
  `meshoptimizer` 1.1.1 transport; runtime country picking remains CPU-based
- Attribution shown in the product: **Made with Natural Earth**

The exact 110m/50m source hashes, generated `.mvg` hashes, raw/gzip/GPU sizes,
geometry counts, and edge limits are recorded in
`src/data/manifests/natural-earth-vector-globe.json`. The 50m asset is 1,824,887
bytes raw and 1,261,484 bytes at the verifier's gzip level; its measured runtime
GPU buffer and palette allocation is 7,945,026 bytes. Four interior samples per
triangle plus adaptive boundary subdivision limit dropped candidate area to
0.000027% at 110m and 0.00017% at 50m, with hard global and
representative-country gates. Hover and selection changes update a small RGBA
palette only; the palette carries no data values.

Coverage is also checked independently against `d3.geoArea` on source country
features, not against converter candidate triangles. For this snapshot the 50m
country-feature sum and TopoJSON land union both equal `3.613763920 sr` within
floating-point precision; they are recorded separately because other datasets
may contain overlaps or disputes. The emitted 50m surface is `3.613757858 sr`,
an absolute relative difference of `0.00017%`. The converter classifies projected
rings by area and containment rather than trusting source ring order; this is
required for the polar Antarctica part whose seam ring precedes its coastline.
The country build removes ring crossings introduced by simplification, so no
source country ring self-intersects; the converter still reports any and would
apply its narrow 0.25% repair ceiling, while valid countries keep a 0.1%
ceiling.

## GeoNames major cities

- Source: [GeoNames geographical database](https://www.geonames.org/)
- Snapshot: `cities15000`, `alternateNamesV2`, `countryInfo`,
  `admin1CodesASCII`, and upstream readme captured together at
  `2026-08-01T09:39:05.688Z` (`2026-08-01 17:39:05.688` Asia/Shanghai)
- Terms: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)
- Use: offline bilingual major-city autocomplete and bilateral nearest
  represented major-city results in Other Side
- Scope: active `P` records with codes `PPL`, `PPLA`, `PPLA2`, `PPLA3`,
  `PPLA4`, `PPLC`, or `PPLG`; all `PPLC` and `PPLA`, otherwise population at
  least 100,000; a non-empty admin-1 code and exact country and admin-1 joins
  are required
- Transformation: select current English and `zh-CN`/`zh-Hans`/`zh` names;
  convert only those existing Chinese source names from OpenCC traditional to
  Simplified Chinese using `opencc-js` 1.4.1 `t` to `cn` dictionaries; retain
  every distinct accepted original Chinese form and distinct simplified
  derivative as aliases; retain canonical/ASCII names and at most two
  additional non-display English aliases; sort by GeoNames ID and encode
  coordinates at 1e-5 degree precision
- Attribution shown in the product: **Contains GeoNames data, licensed under CC
  BY 4.0**, with a no-warranty statement

The final index contains 6,953 records. Its exact five captured source hashes,
HTTP `ETag`/`Last-Modified` identities, immutable build-input hash, derived
hash, size measurements, fallback policy, and transformation are recorded in
`src/data/manifests/geonames-major-cities.json`. Missing Chinese source names
remain explicit canonical fallbacks; non-Chinese names are never translated.
GeoNames is a filtered search index, not a complete gazetteer or territorial
authority. Each relation distance is measured independently from an exact
endpoint to the nearest eligible entry in this same immutable index, with
deterministic distance, population, and GeoNames-ID ties. Results do not mean
nearest settlement, administrative boundary, or built area.

## Community surname observation

- Primary source: [Popular Names by Country dataset v1.2](https://github.com/sigpwned/popular-names-by-country-dataset/tree/v1.2), with source-list provenance from [Wikipedia surname lists](https://en.wikipedia.org/wiki/Lists_of_most_common_surnames)
- Snapshot: CSV released 2023-07-16; the repository records lists collected during the week of 2023-07-08
- Terms: the dataset repository declares [CC0](https://creativecommons.org/publicdomain/zero/1.0/); upstream Wikipedia list pages retain [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) provenance
- Supplements, each pinned by URL and SHA-256 in the manifest and never compared numerically with the primary lists:
  - Sweden: Statistics Sweden's 2012 `Namnstatistik` table lists `Andersson` at rank 1 with 251,621 individuals, through the immutable capture <https://web.archive.org/web/20130921054130id_/http://www.scb.se/Pages/TableAndChart____31063.aspx> (SHA-256 `8e5d469eabd46e67174b45bfccc73d2097a93af1e88b199694e78a5a196e4ad9`); the Wikipedia review page is pinned separately.
  - Iran: the [Iranian Surname Frequencies](https://github.com/farbodbj/iranian-surname-frequencies/tree/9fb2fdccb62445b52e933d4d7929a52e01bd6011) community sample at commit `9fb2fdcc`, [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
  - Africa: one source-listed surname per listed country from a [Pulse Nigeria article](https://www.pulse.ng/story/these-are-the-most-common-surnames-in-every-african-country-2024121210174957832) retrieved 2026-09-23. Only the factual country/surname pairs are used; no rank is asserted.
  - Manual observations: 70 sovereign countries carry one fixed, country-specific surname that cites only the general [Lists of most common surnames](https://en.wikipedia.org/wiki/Lists_of_most_common_surnames) index, without pinned per-record evidence. The product owner accepted shipping them on 2026-10-07 on the condition that each is labelled in the result panel as manually compiled and not individually verified.
- Transformation: group local and romanized variants by `Name Group`, join ISO2 codes to the globe's Natural Earth numeric ids with a pinned GeoNames `countryInfo.txt` mapping, and keep source-listed and manual records unranked
- Missing-value policy: count, share, year, transliteration, and Chinese presentation remain null when the source does not provide them. Chinese forms, native-script spellings where the principal language is not written in Latin letters, and two spelling corrections come from Mundus's reviewed editorial table (`src/features/surnames/surnameNameForms.ts`), applied on top of the unmodified snapshot; nothing is transliterated or synthesized at runtime.
- Scope: this is a community-compiled cultural observation, not a unified official global ranking or census comparison

The derived asset has 241 country entries. 198 carry 288 records (74
rank-one, 144 source-listed and 70 manual observations); the other 43 are
non-sovereign entries without a country-specific source and stay empty. All 195
sovereign countries have a record (71 rank-one, 54 source-listed and 70 manual
observations). The asset is 93,515 bytes (7,226 bytes gzip), and its source
hashes and transformation contract are in
`src/data/manifests/surnames-by-country.json`. Raw CSV, article and
country-info files are not committed. The result panel links each country's
source page and labels manual observations; the About dialog carries the
dataset notices and licenses.

### Surname coverage audit

`src/data/generated/surname-coverage.json` classifies each of the 240 Natural
Earth country anchors as rank-one (74), source-listed (54), manual
observation (69) or no-source (43), plus a separate 195-country sovereign
audit. It is derived from the surname asset and the
Natural Earth anchors; see `src/data/manifests/surname-coverage.json`.

### Surname wordmark slots

`src/data/generated/surname-label-slots.json` (slot schema 8, 1,111 candidates,
690,885 bytes, 78,034 bytes gzip) stores precomputed wordmark centres, sizes
and rotations derived from the pinned Natural Earth 50m country geometry
(public domain) by `scripts/build-surname-label-slots.mjs`. Wordmarks stay
inside their own country (isolated islands may overflow into open ocean
within an area-scaled cap). They follow the local parallel by default; only
countries whose interior is at least twice as long as it is wide are offered a
straight wordmark rotated along that axis. Each wordmark shape (square, medium,
long) also gets a centred candidate that trades size against distance from
the country's label anchor; the runtime applies the same score, so a single
CJK character such as 王 sits in east-central China rather than on the
Tibetan plateau. Output numbers are rounded to nine
significant digits so rebuilds with the pinned Node.js release are byte-stable.
The 50m geometry and this table load only when the Surname Atlas opens.

## GHSL Urban Centre Database

- Source: [GHS-UCDB R2024A](https://human-settlement.emergency.copernicus.eu/ghs_ucdb_2024.php), V1.1, released 2025-07-31
- Terms: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); redistribution is allowed with attribution
- Citation: Mari Rivero, Ines et al. (2024), _GHS-UCDB R2024A - GHS Urban Centre Database 2025_, European Commission, Joint Research Centre (JRC) [Dataset], DOI `10.2905/1a338be6-7eaf-480c-9664-3a8ade88cbcd`
- Use: Urban Proximity's 2025 urban-centre population, focal-city selection, hierarchical proximity distance and Top 10 ranking
- Thresholds: competitor universe `>= 100,000`; focal cities `>= 1,000,000`; α `0.10–1.00`
- Transformation: the official GeoPackage was exported to a temporary CSV, Mollweide centroid x/y were converted to WGS84, coordinates were rounded to four decimals, and record holders plus exact or reviewed GeoNames Chinese city names were generated offline. Proximity name candidates are report-only and do not enter the asset; Chinese country names come from the complete reviewed GHSL-country table. The immutable input and derived asset are verified by `src/data/manifests/urban-isolation.json`.
- Caveats: adjacent cities can merge into one urban centre; 2025 populations are modelled grid estimates rather than census counts; and a large or irregular centre's centroid can sit away from its historic centre. Distances are geometry between centres and do not represent travel or economic access.
- The runtime loads only the compact derived asset when Urban Proximity opens; raw downloads remain outside Git. The method note with the exact licence sentence, package hash and coordinate formula is [docs/data/ghsl-ucdb-r2024a.md](docs/data/ghsl-ucdb-r2024a.md).

## Reshaped Earth

Reshaped Earth uses one shared **2020** snapshot for four quantities at country
and first-level administrative scales. Sources and licences were checked on
2026-10-10; exact download identities, hashes and selection metadata are pinned
in `scripts/reshaped-earth/sources.mjs`. At publication,
`src/data/manifests/reshaped-earth.json` must record those source identities
and the actual derived assets' hashes and sizes. Its current placeholder
entries do not identify accepted production assets.

Production cartograms have not passed publication acceptance. Candidate
assets are not release data; the source and method contract below defines
what must be satisfied before publication.

| Quantity                | Source and version                                                                                                                                                                       | Terms                                                                 | Interpretation                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Population              | European Commission, Joint Research Centre, [GHS-POP R2023A V1-0](https://human-settlement.emergency.copernicus.eu/ghs_pop2023.php), epoch 2020, WGS84 30 arcseconds                     | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)             | Modelled persons per cell                                                                                                                                        |
| GDP                     | Kummu et al., [global downscaled GDP grids v4](https://zenodo.org/records/18429133), `rast_gdpTot_1990_2024_5arcmin.tif`, band description 2020                                          | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)             | **2021 international dollars (PPP)**, as specified by v4, not nominal GDP                                                                                        |
| CO₂                     | Jones et al., [GCP-GridFED v2025.1](https://zenodo.org/records/17467681), complete 2020 archive from UEA                                                                                 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)             | Tonnes CO₂/year; monthly oil, coal, gas and cement-calcination emissions summed, excluding international aviation/shipping bunkers and cement-carbonation uptake |
| Night lights            | Li, Zhou, Zhao & Zhao, [Harmonized DMSP–VIIRS NTL v10](https://figshare.com/articles/dataset/9828827/10), `Harmonized_DN_NTL_2020_simVIIRS.tif`                                          | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)             | Sum of DN 0–63, a relative brightness index with sensor saturation; not physical radiance                                                                        |
| Administrative geometry | [Natural Earth 5.1.2 admin-1](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson) and the full-detail Mundus country view above | [Public domain](https://www.naturalearthdata.com/about/terms-of-use/) | Administrative ownership follows the Mundus country raster; boundaries are not a legal authority                                                                 |

The build scans a 30-arcsecond classification raster without loading the entire
global raster into memory. Population and night-light samples are mapped by
their actual geographic pixel centres. The shifted GHS-POP affine grid is
preserved; a population-only coastal search within two classification pixels
assigns nearby coastal samples to land. Coarse GDP and CO₂ counts are divided
between labelled land subpixels in proportion to their spherical intersection
area. Country totals are sums of administrative children, missing stays `null`,
and actual zero stays zero. At publication, unassigned amounts, conservation
error, source metadata and name coverage must be recorded in the manifest. Offshore CO₂ and
areas with no represented unit can remain unassigned.

The continuous cartogram uses Gastner, Seguy & More's
[2018 fast flow method](https://doi.org/10.1073/pnas.1712674115) on a
2048×1024 cylindrical equal-area grid. Density is quantity divided by true
unit area. Oceans, Antarctica and missing units receive mean density; actual
zero values use a 1% mean-density display floor. The final area ratios are
measured from the deformation rather than substituted from target shares.
The publication manifest must record each of the eight maps' orientation,
area, inverse round-trip and quantization checks. See
[the method contract](docs/data/reshaped-earth.md) for the full acceptance
thresholds, boundary-adjustment rules, budgets and rebuild commands.

Only compact derived metadata, opaque ID PNGs and encoded inverse fields are
redistributed. They retain the source attribution above and CC BY 4.0 where
applicable. Raw GeoTIFFs, netCDF4/HDF5 files and classification caches remain
outside the worktree. Every source notice and the method summary appears in
the About dialog.

## Solar calculations

- Method source: [NOAA Solar Calculator calculation details](https://gml.noaa.gov/grad/solcalc/calcdetails.html)
- Dataset: none; results are calculated in the browser from a UTC timestamp and
  selected coordinates
- Use: solar declination, equation of time, subsolar point, solar elevation,
  and approximate sunrise and sunset in Sunline
- Transformation: NOAA/Meeus-style approximations with an apparent altitude of
  `-0.833°` for sunrise and sunset; inputs are limited to 2000–2099 and minute
  precision
- Redistribution: no external solar dataset is bundled

The result is an educational approximation. Atmospheric conditions and high
latitudes introduce additional error; it must not be used for legal,
navigational, or engineering purposes. NOAA states that this calculator is no
longer actively maintained and does not guarantee its accuracy or
functionality.

## Reproducibility

The generated snapshots are produced by scripts in `scripts/`. Each build
script pins the source URL and expected SHA-256 before transforming data. To
rebuild the GeoNames index from a clean checkout, run:

```bash
pnpm data:cities
```

The command reads only the tracked, immutable, normalized CC BY 4.0 build input
at `src/data/generated/geonames-major-cities-input.json`, verifies its SHA-256,
and atomically regenerates the runtime index. It performs no network access and
does not require a raw cache. The compact input contains only eligible city
fields, exact joined country/admin records, and relevant current English and
Chinese alternate-name rows needed to reproduce name selection, OpenCC
conversion, aliases, deterministic ordering, and every runtime field.
The current schema 2 input omits empty alternate-name groups and the redundant
nested GeoNames ID from each alternate row.

A reviewed upstream refresh is a separate operation:

```bash
pnpm data:cities:capture
```

That command captures all five official rolling files into a unique ignored
directory under `tmp/geonames/`, records the actual bytes' hashes and HTTP
identities, and keeps that directory immutable through verification, extraction,
generation, and tracked publication. A concurrent capture cannot replace the
source path being parsed by another process. Overlapping generated destination
sets are serialized by bounded filesystem locks containing owner PID, process
identity, and acquisition time. Any existing lock waits for a bounded period and
then fails closed; locks are never reclaimed automatically, even when old,
malformed, or associated with a dead PID. An operator must inspect and manually
recover any interrupted lock. Publication replaces the input and runtime before
publishing the manifest last; a forward failure restores the prior complete
generation. If restoration itself fails, all restores are still attempted, the
publication and rollback errors are aggregated, and a durable owner-independent
`recovery-required` sentinel remains in every held lock. Each lock begins with a
`publication-active` sentinel; after a forward error, the recovery sentinel is
atomically created in every lock before rollback starts. If sentinel creation is
interrupted or fails, rollback does not start and the active sentinel remains a
permanent automatic-recovery barrier. A fully successful rollback removes the
recovery sentinel and permits normal owner-only lock release. Otherwise an
operator must inspect the recorded staging/backup paths and perform manual
recovery; there is intentionally no destructive automatic recovery command.
Metadata may add diagnostic recovery paths, but reclamation safety does not
depend on metadata. A mutable URL is provenance, not sufficient rebuild
identity. Raw sources are never committed. Then run:

```bash
pnpm data:verify
```

to verify the committed generated snapshots, including the Mundus country
topologies, by SHA-256. Rebuild the country topologies from the pinned Natural
Earth sources, then the assets derived from them, with:

```bash
pnpm data:countries
pnpm data:vector-globe
pnpm data:label-anchors
pnpm data:surnames
pnpm data:label-slots
pnpm data:surname-coverage
```

`pnpm test` separately exercises the
data registry schemas, record-level expectations, and calculation invariants;
the generator scripts validate their input and output while building a new
snapshot.
