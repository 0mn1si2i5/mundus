# City reach: traffic-weighted city competition

Status: deployed. The owner approved this replacement for Urban Proximity's
`view=field` on 2026-10-11 and accepted the coarse-waterway connections on
2026-10-12. The data assets (PR #37) and the field view (PR #38) shipped in
v1.2.0 on 2026-10-12 and replaced the geometric `d/R` field. The global assets
were generated from captured fixed inputs.

## Question and model

At a selected reach level, which city has the lowest travel-time cost after
allowing for its population advantage?

```text
score_i(x, k) = T(x, S_i) - k * log10(P_i)
owner(x, k) = arg min_i score_i(x, k)
levels = [0.25, 0.5, 1, 2, 4, 8, 16]; default = 4
```

`P_i` is the GHSL urban centre's 2025 population, not city-proper population.
All centres with population at least 100,000 participate. `S_i` is the centre's
retained set of road-accessible grid cells. `T` is the shortest path from the
place to that set, in hours. The graph is symmetric in this edition. Each
tenfold increase in population gives a city `k` hours of advantage. Equal
scores favour larger population, then smaller numeric GHSL id.

This is a transparent thought experiment. The friction surface is an estimated
travel cost, not a measured trip, and the resulting territories do not describe
commuting, healthcare, economic ties or administrative jurisdiction. GDP is
outside this edition. The single-city geometric distance `R(alpha)` stays
unchanged and is independent of `k`.

## Fixed inputs and licences

| Input                  | Version and identity                                                                                                                                                                     | Use and terms                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| GHSL GHS-UCDB          | R2024A V1.1, ZIP SHA-256 `7b644df16b0791f88c3db28ce56338b5e1725be02b6a79ca253849822db26b21`                                                                                              | Urban polygons, official `UC_centroids`, `GC_POP_TOT_2025`; CC BY 4.0 |
| Natural Earth Admin 0  | 5.1.2, default GeoJSON SHA-256 `239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255`, China view SHA-256 `a13bf5f310fde87bc0a5f994f8ce9bd706cc198d8ee37d221e61c2546b945372` | Routing and display-country labels; public domain                     |
| MAP motorized friction | 2019, WCS coverage `Accessibility__202001_Global_Motorized_Friction_Surface`                                                                                                             | Minutes per metre; CC BY 4.0, with OSM input attribution              |
| GHS-POP                | R2023A V1.0, 2020 epoch, EPSG:4326 30 arcseconds, ZIP SHA-256 `579fb7477b33d9be61e9562b170ea108a670b85ef6fe23b61a22d17200929636`                                                         | Display brightness and population-impact reports only; CC BY 4.0      |

The GHSL download and citation are recorded in
[ghsl-ucdb-r2024a.md](ghsl-ucdb-r2024a.md). Natural Earth uses the same source
files as `scripts/build-mundus-countries.mjs`, before display simplification.
GHS-POP's official page is
<https://human-settlement.emergency.copernicus.eu/ghs_pop2023.php>; its fixed ZIP is
<https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/GHS_POP_E2020_GLOBE_R2023A_4326_30ss/V1-0/GHS_POP_E2020_GLOBE_R2023A_4326_30ss_V1_0.zip>.
Its 2020 population must never replace the 2025 population in the score.

MAP's friction surface is described by Weiss et al. (2020), _Global maps of
travel time to healthcare facilities_, Nature Medicine,
<https://doi.org/10.1038/s41591-020-1059-1>. Data and terms:
<https://malariaatlas.org/research-project/accessibility-to-cities/> and
<https://developers.google.com/earth-engine/datasets/catalog/Oxford_MAP_friction_surface_2019>.
MAP publishes the derived raster under CC BY 4.0. Its road inputs include
OpenStreetMap, licensed under ODbL. The owner accepted the residual licence
interpretation risk on 2026-10-11: publish calculated ownership results, not
the friction raster, and credit both MAP and **© OpenStreetMap contributors**
(<https://www.openstreetmap.org/copyright>).

MAP's service provides no authoritative checksum. An explicit capture records
each 10-degree response's SHA-256 and exact request, dimensions, affine grid
and pixel hash. The first new request is repeated to check both response bytes
and decoded pixels. Canonical float32 little-endian pixel hashes identify the
source even if response metadata changes bytes. Rebuilds reject changed pixels; they never
silently refresh the capture. A research aggregate without these identities
is a comparison input, not a production source.

## Grid, countries and paths

The computational grid is 10,800 columns by 4,350 rows, from 180°W to 180°E
and 85°N to 60°S, at 1/30°. Cell centres are:

```text
longitude = -180 + (column + 0.5) / 30
latitude = 85 - (row + 0.5) / 30
```

At the equator cells are about 3.7 km across; east-west width decreases with
latitude. MAP pixels are 1/120°. In each 4-by-4 block, a valid pixel is finite
and positive; a water pixel differs from 0.00316 by at most 0.000002 minutes
per metre. A coarse cell is land if any valid non-water pixel exists, and its
friction is the minimum of those land pixels. Missing friction stays missing.

Countries are rasterised by cell centre. Drawing labels use the Mundus China
view with Taiwan separately taken from the default layer; routing starts from
Natural Earth's default layer. Disputes are drawing/routing label differences
with different `SOV_A3` values, plus raw routing units KAS and SAH. They remain
in the path graph, but the published ownership display masks them with hatching.
The interface says **争议地区，不显示归属 / Disputed area; no assignment shown**.

Routing merges KAS into IND, KAB into KAZ and SAH into MAR. CNM, BRT, BJN,
SER, SCR, SPI, PGA and ATA become unknown labels. An unknown land cell inherits
the closest labelled country by Euclidean grid distance, without wrapping
longitude for this assignment. Equal distances use a deterministic cell order.
This is an approximation, and paths through these cells are reported.

Eight-neighbour edges join land cells, wrapping columns across the
antimeridian. Edge weights in hours are the mean of endpoint friction values
times edge length in metres, divided by 60. With `R = 6371008.8 m`, north-south
length is `R * pi / (180 * 30)`, east-west length is that value times the cosine
of the row's latitude, and a diagonal uses the mean east-west length of its
two rows and the Pythagorean length. Cross-country edges are removed unless
their country pair is explicitly open.

The approved open policy is:

- Schengen units AUT, BEL, BGR, HRV, CZE, DNK, EST, FIN, FRA, DEU, GRC, HUN,
  ISL, ITA, LVA, LIE, LTU, LUX, MLT, NLD, NOR, POL, PRT, ROU, SVK, SVN, ESP,
  SWE and CHE, plus model extensions MCO, SMR, VAT, AND and ALD;
- GBR–IRL, GBR–IMN and IRL–IMN;
- IND–NPL and IND–BTN;
- CHN–HKG, CHN–MAC and HKG–MAC;
- CYP–WSB and CYP–ESB;
- FRA–MAF and MAF–SXM.

Each rule's basis, source link and review date are kept with the machine-readable
policy. Inclusion means the model permits crossing; it does not assert unrestricted
entry rights or remove border delays already present in the friction surface.
USG, PSX–ISR, CYN–CYP and GIB–ESP stay closed. No explicit ferry edges are added.
Bridge/tunnel connections are present only where the friction pixels encode
them; an open country pair alone does not create a sea crossing. Coarse
aggregation can nevertheless treat waterways of roughly 7 km as connected:
land pixels at the far edges of adjacent cells can bridge almost two cell
widths. This is not a strict width limit, and diagonals can span wider water.
Examples include Bali–Java, Negros–Cebu and Tierra del Fuego–the South American
mainland. Ferries themselves are not included. The owner accepted all 13,303
reported coarse connections on 2026-10-12. The complete source-bound approval
is archived outside Git; the generated source summary retains its hashes and
counts. The independent review found 9 connections
whose smaller side has over 100,000 residents, 82 over 10,000, and no leakage
across closed borders.

## City sources, thresholds and names

GHSL GeoPackage polygons are converted from World Mollweide to WGS84 and
rasterised with all-touched semantics, in ascending population order so that
larger centres retain overlapping cells. Only land cells in the centre's
majority routing country remain. The report preserves each affected id,
removed cells, 2020 grid population and centroid movement. Country display
names still follow the GHSL field and the reviewed country-name table.

The reference point is the official `UC_centroids` record, never a polygon's
representative point. The centre cell is the centroid cell if retained;
otherwise it is the closest retained source cell. A centre with no retained
source gets an explicit merged, missing or disputed state, with its merging
city recorded where one exists.

For a valid centre cell, the centre-assignment threshold and parent are:

```text
k_c(i) = min over P_j > P_i of T(c_i, S_j) / log10(P_j / P_i)
parent(i) = the city attaining this minimum
```

The parent has strictly greater population, so parent pointers are acyclic.
This is the threshold at which the centre changes owner. For a multi-cell
urban centre it does not mean its entire source area or territory disappears.
The start-of-erosion and complete-disappearance thresholds are outside this
edition. The original research used all 11,422 centres and representative
points: its global counts and parent examples are not acceptance numbers for
this edition's at-least-100,000 population universe.

Finite thresholds are stored as numbers. Infinity is represented by a state
and `null`, never a JSON numeric value. Keep these distinctions:

| State                  | Meaning                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `ok`                   | A larger reachable city gives a finite threshold and parent                                   |
| `root`                 | A maximum-population city; no larger candidate exists                                         |
| `no_larger_reachable`  | A larger candidate exists but is not reachable; the city is a root of its transport component |
| `merged_at_resolution` | Shared coarse cells leave no independent source; record the absorbing city                    |
| `transport_missing`    | The centre/source has no usable friction coverage                                             |
| `disputed`             | Its reference centre is in a disputed display cell                                            |

The mathematical forest has a root in each component, including cities whose
display state is `no_larger_reachable`. Only finite thresholds may be ranked.
The interface explains a local root as **所在陆块/岛屿（交通连通区域）中人口最大的城市 /
Largest city on its landmass or island (transport-connected area)**.
The parenthetical qualification matters: closed borders can split a landmass,
and approved coarse-waterway connections can join nearby islands.

Names reuse the owner-reviewed `isolationNameOverrides.ts`, GeoNames exact
matching and `isolationCountryNames.ts`. Proximity suggestions are report-only.
Reviewed `nameEn` always wins; a GHSL raw label appears only in the review
report's **GHSL name** column. Every city that owns any published territory,
is a parent, or is a component root must have a nonempty English display name.
Missing approved Chinese city names remain null and the Chinese interface
falls back to English. The manifest and build name report record both the total
and required-city missing counts, with override, exact and none provenance.
After the 99-row correction, those counts are 270 override, 2,125 exact and
3,549 none; 2,946 required cities still have no reviewed Chinese name and
fall back to English.
All asset countries require reviewed Chinese labels. Chinese duplicates fail
unless both assignments are reviewed overrides. The owner-approved labels
for Kosovo and Northern Cyprus are 塞尔维亚（科索沃） and 塞浦路斯（北部）,
respectively, consistent with the drawing-country view. The complete 99-row
owner-reviewed city-name table was applied in the names correction following
v1.2.0; no additional translations are inferred by the build.
The owner separately approved the explanatory English label
**Unnamed urban centre (GHSL 4893)** for the unnamed Sudanese centre at
11.5391°N, 34.3126°E. Its Chinese name stays null. This label records the
source's missing name and does not claim a verified place name.

## Encoding and frontend budget

Owner codes index the city table, independently of GHSL ids. Code 0 means no
reachable city and 65535 means disputed. The city table records the stable
owner index, GHSL id, names, country, 2025 population, coordinates, threshold,
parent, state and merge reference.

Ownership tiles are **RGB8 PNG**, with code `R + 256 * G` and B strictly 0.
A separate shared **RGB8 density PNG** stores quantised density in R, with
G and B strictly 0. Neither file stores data in alpha: the PNGs have no alpha
channel, so browser alpha premultiplication cannot alter city codes. The browser
expands them to opaque RGBA for display.

Density uses GHS-POP 2020 summed by source-pixel centre onto the computational
grid, divided by spherical cell area, then quantised by
`round(254 * min(1, log10(1 + density) / 4))`. Values 0–254 encode valid density,
including zero; 255 marks a coarse cell with no valid population source pixel.
Density controls brightness only, never ownership or competition strength.
All seven k levels reference the same single density asset.

The owner decided on **2026-10-12** to publish only the roughly **15 km**
display precision. This supersedes proposal **D5**'s original 1/30° display
requirement. Increasing display precision requires a separate owner approval.
High and medium display assets are not generated or published. Computation
stays at 1/30°; thresholds, parents and the complete city-name review set are
unchanged.

The sole display tier is `low`, stride 4, 2,700 by 1,088 pixels. Each pixel
samples the central source cell of its fixed four-cell stride block; the last
partial block clips that sample to the last source row or column. Thus the
last display row retains the 4,350th computational row rather than stretching
four-row blocks across the grid. CPU lookup and globe rendering use exactly
the same samples, including the dateline. No 16-bit PNG or interpolated
categorical code is allowed. Each PNG is below the 4,096 texture-edge limit.

| Allocation                                               | Bytes      |
| -------------------------------------------------------- | ---------- |
| One owner RGBA texture                                   | 11,750,400 |
| Shared density RGBA texture                              | 11,750,400 |
| One Uint16 CPU owner array                               | 5,875,200  |
| Two owner textures plus shared density during transition | 35,251,200 |

Decoder buffers, the colour palette, CPU density bytes and other renderer
resources are additional to these allocations. Only the active owner level
and shared density remain resident; loading the next level can retain a second
owner texture. Exiting releases decoded and GPU resources. Both phones and
desktops use this same display precision.

Re-encoding the completed 5,944-city computational result on 2026-10-12
measured:

| PNG                | Bytes         |
| ------------------ | ------------- |
| Ownership k=0.25   | 130,199       |
| Ownership k=0.5    | 124,272       |
| Ownership k=1      | 114,119       |
| Ownership k=2      | 100,034       |
| Ownership k=4      | 83,504        |
| Ownership k=8      | 70,160        |
| Ownership k=16     | 59,429        |
| Shared density     | 530,915       |
| **All eight PNGs** | **1,212,632** |

The default k=4 owner plus shared density is 614,419 PNG bytes. The schema and
published-data verifier enforce **3,000,000 bytes maximum for all eight PNGs**;
this is a total raw compressed-file budget, not a per-level or gzip-only limit.
These measurements exclude the 2,283,931-byte city table, 27,317-byte source
summary and manifest. The final manifest is the authority for published sizes.
An exhaustive comparison against the previous low-detail assets found zero
owner-code or density-value changes across all seven levels. The only removed
city-table field was unused top-level `thresholdUnit`; names, coordinates,
thresholds and parents remain identical.

Field levels use `reach=<k>` in the URL, omitted at 4. Invalid values return to 4. `alpha` keeps its existing parse and serialization semantics and changes
only the city view. Level changes replace history, while view and point changes
push it. No field assets are requested in the lobby or geometric city view.
A failed new level retains the last successfully loaded level, labels which
level is still displayed, and offers retry. Card and globe must change together.
**Known limitation:** the selected location’s ownership chain across all k levels
is not shown in this edition.

## Build, reports and validation

The Node-only pipeline is `scripts/build-city-reach.mjs`, with reusable
modules under `scripts/city-reach/`. GeoPackage reads use Node's SQLite;
GeoTIFF decoding is a pinned build-only dependency. Raw sources and captured
aggregates live outside the checkout. Publishing the complete asset set and
manifest is transactional, through `publish-asset-set.mjs`. Generated JSON,
PNG and manifest files are never hand-edited.

The solver adds a virtual source with cost
`k * (max(log10(P)) - log10(P_i))` to each source cell and runs multi-source
Dijkstra. Threshold searches reuse buffers and stop only when the current
distance is strictly greater than `best * (globalMaxLogPopulation - log10(P_i))`.
The global maximum gives a conservative bound for every transport component;
strict comparison retains candidates tied at the stopping boundary.
This is a safe bound, not a nearest-N-city heuristic.

The complete MAP capture and reviewed waterway connection list are archived
outside Git under the external cache’s `source-records/` directory as
`source-capture-<sha256>.json`; their full records also remain in the completed
computation cache and the owner’s review archive. Publication first validates
the full 540-tile capture and the exact approved connection list, then writes
`city-reach-source-summary.json`. The summary records the complete file’s
SHA-256 and size, MAP capture hash and tile count, and approval/source-digest,
connection-list hashes and statistics. It contains no response tiles or
connection examples. The summary also records the required city ids from the
full computational grids, final parents and roots, so lower display precision
does not silently reduce the name gate or name counts. Runtime code does not
consume this provenance record.

Production reports outside Git include source capture identities, cross-border
clipping, source-cell merges, root and missing-state counts, paths using unknown
country cells, coarse-grid water connections, no-city-reachable population,
territory counts per level and zero population-monotonicity violations. A
coarse/fine connectivity comparison must identify narrow-water links rather
than assuming that two land-containing coarse cells imply a real connection.
UK and US calibration is rechecked at the chosen computational resolution
before any commuting/healthcare scale labels are proposed; those labels are
not part of this release.

Mathematical tests compare ownership and thresholds with independent all-pairs
solutions on small graphs, including equal scores, closed borders, disconnected
components and the antimeridian. They verify:

- T1: owner population never decreases as `k` increases;
- T2: every ownership component contains a source cell of its owner; this does
  not forbid holes, surrounding regions, or disconnected multi-cell sources;
- T3/T4: a source/centre changes to a larger city at its computed threshold,
  including the tie rule at equality;
- parent pointers strictly increase population;
- rasterisation, nearest-country assignment, 4-by-4 aggregation and RGB8 codes
  independently agree with small, hand-calculated cases.

`pnpm data:verify` validates the committed provenance summary and pinned fixed
source identities, PNG dimensions, codes, decoded budgets, city references and
asset hashes without downloading or recomputing the world. It checks that the
full-grid required-name ids cover every displayed owner, parent and root. This
routine check verifies the published summary; it does not replay the externally
archived MAP response records. Full capture and exact waterway approval remain
mandatory in the publication pipeline. Ordinary checks never run a global build.

Use the pinned Node and pnpm toolchain from `package.json`:

```bash
pnpm data:city-reach --estimate
pnpm test:data-city-reach
pnpm data:city-reach --benchmark --region -6,50,-2,54 --capture-map
```

The regional benchmark is limited to 250,000 cells and never publishes a
production manifest or texture. `--cache <directory>` selects storage outside
the checkout; `--ghsl-zip` and `--population-zip` can reuse existing fixed
archives after verifying their hashes.

After the owner accepts the global resource plan, the first global command is
`pnpm data:city-reach --build --capture-map`. Capture checkpoints allow an
interrupted download to continue with the same command. A subsequent build
without `--capture-map` requires the complete capture and rejects changed
sources. Reports are written to the ignored `tmp/city-reach/` directory.
Completed ownership, thresholds, density and reports are saved in the external
cache with a source-and-model identity and per-file hashes. Updating reviewed
names or approving the exact waterway report reuses this completed computation.
A display-only re-encoding can explicitly select its verified result with
`pnpm data:city-reach --reencode-cache <identity> --waterway-audit <reviewed-report>`.
That path checks completion and every cached file’s hash, then publishes from
existing owners, thresholds and density; it never downloads or runs the solver.
Interrupted downloads resume from validated tiles; an interrupted solve that
has not written its completion marker reruns the computation from those inputs.
Required English names, all country labels and coarse-waterway connections
must meet the reviewed contract before publication; `--waterway-audit <reviewed-report>` must match the automatically
generated source digest and connection list exactly. Name overrides follow the
same owner-review process as the existing geometric observation.

Before the first global run, `AGENTS.md` §7 requires agreement on peak memory,
CPU duration, storage location, retention and cleanup. Research measured
roughly 2.3–3.8 GB RAM for graph/field solving and 2.5 hours for thresholds;
these are Python reference measurements, not a Node performance claim.
The formal resource report includes Node overhead, density raster decoding,
temporary caches and an interruption/restart path. The authorised Node run
completed on 2026-10-12 in 2,743.8 seconds with 1.72 GiB peak RSS; threshold
search took 67.5 seconds. It recorded zero population-monotonicity violations
and zero territory components without a source of their owner. The external
completed-result cache is about 2.1 GiB and is reused for name-only publication
changes. These measurements describe the offline build, not physical-device
rendering performance.
