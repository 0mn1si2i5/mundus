# Urban Proximity — design contract

Status: implemented, pending owner review (2026-10-08). This document
records the product question, data, metric, interaction and acceptance
decisions. The step-by-step execution packet is handed to the executor
separately and is not stored in the repository (see `AGENTS.md` §8).

## 1. Question

> 从一座大城市出发，要走多远才会遇到一座"足够大"的城市？
> How far must you travel from a large city before you meet one that is
> "large enough"?

"Large enough" is not fixed by Mundus. It is the visible control **α**: a
competitor must have at least α times the population of the selected city.

Mundus measures only:

- **geometric proximity** — great-circle distance between city centre points
  (oceans count); and
- **hierarchical proximity** — whether a city of comparable size is nearby.

It does not measure transport, economic or travel-time accessibility and must
not suggest it.

Names: 城市邻近性 / Urban Proximity (mode); 层级邻近距离 / Hierarchical
Proximity Distance (metric). Mode id: `isolation`.

## 2. Data

| Decision            | Value                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Source              | GHSL Urban Centre Database **GHS-UCDB R2024A** (European Commission, Joint Research Centre)                              |
| Licence             | CC BY 4.0 — must be confirmed on the official dataset page before any data is committed (§8 gate)                        |
| City definition     | GHSL **urban centre**: contiguous high-density grid cells, one consistent global definition (not city proper, not metro) |
| Population          | total population for the **2025** epoch                                                                                  |
| Point               | urban-centre centroid in WGS84 degrees                                                                                   |
| Focal cities (F)    | urban centres with 2025 population ≥ **1,000,000** — the cities a user can select and rank                               |
| Competitor universe | urban centres with 2025 population ≥ **100,000**                                                                         |

Completeness invariant: α ≥ 0.10 and P(focal) ≥ 1,000,000 imply that every
eligible competitor has P ≥ 100,000, so the universe is complete for every α
the UI allows. The build must assert this.

Known definitional effects, shown in the method note and never hidden:

- adjacent cities can merge into one urban centre (for example parts of the
  Pearl River Delta), which removes them as competitors of each other;
- populations are modelled grid estimates for 2025, not census counts;
- the centroid of a large or irregular urban centre can sit away from the
  historic centre.

Rejected sources: UN WUP 2025 cities (redistribution terms for the city file
not confirmed; mixes national urban definitions); Natural Earth populated
places (inconsistent population sources); GeoNames populations (administrative
city proper). The bundled GeoNames snapshot is used only to attach reviewed
Chinese names (§5).

## 3. Metric

For focal city i with population Pᵢ and a candidate j ≠ i in the universe:

```text
eligible(j; i, α)  ⇔  Pⱼ ≥ α · Pᵢ                      (inclusive)
R_i(α)  = min over eligible j of d(i, j)                 (km)
J_i(α)  = the j achieving R_i(α)
α ∈ [0.10, 1.00]; UI step 0.01; default 0.50
```

- `d` is the haversine great-circle distance on a sphere of radius
  **6371.0088 km** (the radius already used by Other Side). The ellipsoid error
  (< 0.5%) is stated in the method note.
- Ordering ties: smaller distance, then larger population, then smaller source
  id.
- **No competitor:** if no universe city satisfies Pⱼ ≥ α·Pᵢ, R_i(α) is
  undefined. The UI says so explicitly ("数据集中没有至少为它 α 倍大的城市"),
  and the city is excluded from the ranking at that α. Never show infinity or 0.

Step representation (exact, no floating thresholds stored):

1. Sort the other universe cities by (distance, −population, id).
2. Walk the list keeping the largest population seen so far. A city becomes a
   **record holder** when its population is strictly greater than every city
   before it.
3. The record holders `k₁, k₂, …` have increasing distance and increasing
   population. R_i(α) is the distance of the first record holder with
   P ≥ α·Pᵢ. Stop once a record holder has P ≥ Pᵢ (α = 1 is then covered).
   Drop leading record holders with P < 0.10·Pᵢ, because no allowed α can
   select them.

R_i is a non-decreasing step function of α. Its jumps are the meaning of the
metric and must not be smoothed.

Ranking at α: focal cities with a defined R_i(α), sorted by R descending, then
population descending, then id. Rank is shown as "n / N", where N counts the
ranked cities at that α.

### Global field view

Urban Proximity also has a static **global field** view (`view=field`). It is
the same observation and uses the same α and R_i(α) values; it does not add a
second metric. For each point x on the bundled land surface, ownership is

```text
owner(x; α) = arg min over focal i with defined positive R_i(α) of d(x, i) / R_i(α)
```

where d is the same spherical great-circle distance used above. A larger
proximity distance reduces a centre's weighted distance and extends
its relative reach; the final region also depends on the other centres and their weights.
The result is a weighted spherical Voronoi partition, clipped to land. Its borders
can be curved and irregular; they are geometric boundaries, not coastlines,
administrative borders, terrain catchments or travel-time regions. A tie uses
the same deterministic population-then-source-id order as the rest of the
mode.

Focal centres with an undefined or zero R remain visible and selectable but do
not own a field region. At α = 1 this includes any centre without a qualifying
competitor. The field is categorical: its colours distinguish owners and do
not encode a second continuous score. A selected land point resolves to the
same owner in the result card and globe. Choosing an exact centre retains that
centre even when it has no field region.

The partition changes only when some R_i(α) crosses a population threshold;
moving α within one set of unchanged radii leaves its boundaries unchanged.
These changes are steps and are not animated or smoothed into a continuous
population field.

The field is evaluated on the existing Natural Earth land triangles. A shared,
lazy Web Worker builds conservative tile candidate lists so the fragment
shader can evaluate the exact weighted distance; the lists are an acceleration
structure and never a raster approximation of the boundary. The worker is
started only after entering the field view, is cancelled and its GPU textures
released when α or the view changes, and reports a local retryable error if it
fails. Entering the field view stops the globe's idle rotation so that the
static partition can be inspected and manually rotated. The field view,
selected city and α round-trip through a shared URL (`view=field`).

## 4. Asset

One generated JSON, loaded lazily as a dynamic-import chunk when the mode is
entered: `src/data/generated/urban-isolation.json`. It contains:

- focal cities plus only those universe cities that appear as a record holder
  for some focal city;
- per city: source id, latitude and longitude (1e-4°), 2025 population,
  English name, reviewed Chinese name or null, country English name, country
  Chinese name or null, focal flag;
- per focal city: its record-holder list `[cityIndex, distanceKm]`, with
  distance rounded to whole km.

Budget: raw ≤ 400 KB, gzip ≤ 120 KB. A build-time immutable input
(`src/data/generated/urban-isolation-input.json`: the filtered ≥ 100,000 rows
only) lets the asset be rebuilt offline. The manifest pins the upstream
download URL, SHA-256, licence, citation/DOI, epoch and both thresholds.

## 5. Names

- English: the GHSL main urban-centre name, with reviewed `nameEn` corrections
  from the override table when needed.
- Chinese city names: from the bundled GeoNames snapshot, with build-time
  matching only.
  - A GeoNames city within 50 km whose normalised English name equals the
    GHSL name is used.
  - Otherwise the most populous GeoNames city within 30 km is a **proximity**
    match and is recorded in the build report for review. Proximity matches do
    not enter the shipped asset.
  - GeoNames rows marked as Chinese fallbacks give no Chinese name.
- Reviewed overrides live in `src/features/isolation/isolationNameOverrides.ts`,
  keyed by GHSL id.
- Only exact matches and reviewed overrides enter the asset. The build fails
  if the same Chinese city name is assigned to different GHSL ids unless both
  assignments are reviewed overrides.
- Country names are assigned from the GHSL English country field using the
  complete reviewed table in `isolationCountryNames.ts`; city GeoNames country
  rows are not used. The table must cover every country represented in the
  asset, and uses `刚果民主共和国` for Democratic Republic of the Congo and
  `巴勒斯坦` for Palestine.
- The executor never invents translations. With no reviewed Chinese city name,
  the Chinese UI shows the English name. A missing Chinese name is a recorded
  state, not an error. A centre with an empty GHSL main name remains in the
  competitor universe; if referenced by a focal record-holder list, the build
  requires an override supplying both `nameEn` and `nameZh`.

## 6. Interaction

- Entry: tier `more` (under "更多观察"), beside Sunline. Promotion to a primary
  tab is a separate owner decision after review.
- City view selection: the shared selected point maps to the **nearest focal city**. When
  that city is more than 50 km from the point, the card says "离所选位置最近的
  数据集城市（相距 X km）". Choosing a city from the ranking moves the selected
  point to that city.
- Controls: an α slider (0.10–1.00, step 0.01). Its value is shown as
  "α = 0.50 · 竞争城市人口 ≥ 本城的 50%". Below it, the current-α Top 10 is an
  ordered list of buttons.
- Result card:
  - selected city, its country and 2025 urban-centre population;
  - the competitor and its distance at the current α, or the no-competitor
    state;
  - the rank "n / N";
  - an SVG step chart of R(α) over 0.10–1.00, with a cursor at the current α;
  - a one-line caveat.
- City view globe:
  - focal cities as small dim dots;
  - the selected city and its competitor as accent markers;
  - a thin geodesic ring (small circle of radius R) around the selected city;
  - a great-circle arc to the competitor.
  - No filled discs.
- Global field view:
  - a toggle switches between the city view and `view=field`;
  - all land is assigned by the weighted rule in §3, with one centre per
    region; ocean has no region fill;
  - the city selector remains a keyboard-accessible way to choose any focal
    centre, including one that has no field region;
  - the static view does not use idle rotation, but keeps manual globe
    rotation and selection.
- URL: `mode=isolation&point=…&alpha=0.37&view=field&v=2`.
  - `alpha` has two decimals and is omitted at the 0.50 default.
  - `view=field` is emitted only for the global field view; city view is the
    default.
  - Invalid or out-of-range values fall back to 0.50.
  - Slider moves replace the history entry; mode, view and point changes push one.
- Lazy loading: no isolation chunk or data request in the lobby or other
  modes. The field worker is likewise lazy. A failed data or field build shows
  a local error with a retry action.
- About: a method note and a GHSL credit (CC BY 4.0 + citation). The credit
  line adds "GHSL".

## 7. Acceptance

Mathematics (unit tests):

- R(α) is non-decreasing.
- Every competitor satisfies the threshold.
- The competitor is the nearest eligible city: brute force agrees with the
  step lookup on random fixtures for α on a 0.01 grid.
- Ties follow §3; the no-competitor state appears exactly when expected.
- The completeness invariant holds.
- The field owner follows the weighted d/R rule, including deterministic ties.
- Conservative tile lists retain the brute-force winner at tile boundaries,
  the antimeridian and the poles.

Geography (unit tests):

- the antimeridian;
- poles and near-polar points;
- near-identical coordinates;
- antipodal pairs (the arc helper must not return an empty arc silently);
- small-circle points all at the requested angular radius.

Data (build tests):

- No duplicate ids.
- No population ≤ 0.
- Latitude and longitude are in range.
- A single epoch is used.
- Thresholds and budgets are enforced.
- The offline rebuild is byte-identical.
- A spot check passes: Tokyo's centroid is within 30 km of 35.68 N, 139.77 E.

Product (browser tests, desktop and Pixel 7):

- entering via More;
- lazy loading;
- choosing a ranked city;
- moving α changes competitor, ring and arc diagnostics at a known breakpoint;
- entering `view=field` partitions land by d/R, updates when α crosses a step,
  leaves centres without R selectable, and keeps the field stable after idle
  rotation is stopped;
- the URL round-trip;
- the no-competitor state;
- 44 px touch targets;
- keyboard operation of the slider and list;
- reduced motion;
- no overlap with the header or panels at the existing layout breakpoints.

Release: every repository gate in `AGENTS.md` §5, plus an owner review of the
Chinese-name list and of the top 20 at α = 0.10, 0.50 and 1.00.

## 8. Stop conditions for implementation

Stop and report instead of continuing if:

- the GHS-UCDB R2024A licence is not CC BY 4.0, or it cannot be read on the
  official JRC/Copernicus page;
- the download lacks a usable 2025 population, name, or a centroid that can
  be converted to WGS84;
- the counts are implausible (focal outside 300–3,000, or universe below
  2,000);
- the asset exceeds its budget;
- the change would need edits to the globe kernel beyond adding one layer and
  its diagnostics;
- an existing test can only pass by loosening it.

## 9. History

Research notes (2026-10-06) compared the WUP, GHSL, Natural Earth and
GeoNames sources and discussed weighted Voronoi and gravity fields. Their
conclusions are folded into §2 and §3 above. Candidate "greatest proximity distance" cities
(Perth, Honolulu, Auckland, Ulaanbaatar) are hypotheses until computed from
the pinned dataset; no city is to be presented as an absolute champion,
because every ranking is conditional on the dataset and on α. Cities below the
focal threshold (for example Reykjavík) are outside this first version by
design and can only become competitors.
