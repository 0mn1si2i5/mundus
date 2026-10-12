# Urban Proximity — design contract

Status: the geometric city view is deployed. On 2026-10-11 the owner approved
the replacement global-field contract below; it becomes active only after the
data and frontend pull requests are reviewed and released. This document
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

The city view does not measure transport, economic or travel-time
accessibility. The separate global field uses a travel-cost model (§3); its
territories are a thought experiment, not measured city relationships.

Names: 城市邻近性 / Urban Proximity (mode); 层级邻近距离 / Hierarchical
Proximity Distance (metric). Mode id: `isolation`.

## 2. Data

| Decision            | Value                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Source              | GHSL Urban Centre Database **GHS-UCDB R2024A** (European Commission, Joint Research Centre)                              |
| Licence             | CC BY 4.0 — confirmed on the official dataset page before the committed snapshot                                         |
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

The approved replacement **global field** (`view=field`) asks which city wins
at each place after its population advantage offsets estimated travel cost:

```text
score_i(x; k) = T(x, S_i) - k * log10(P_i)
owner(x; k) = arg min_i score_i(x; k)
k = 0.25, 0.5, 1, 2, 4, 8, 16; default = 4
```

`T` is shortest travel cost in hours through a symmetric eight-neighbour land
graph; `S_i` is the centre's retained GHSL polygon source cells. Population
comes from the same 2025 edition, but every centre with at least 100,000 people
participates, independently of the city view's one-million focal threshold.
A tenfold-larger city gains `k` hours. Equal scores favour larger population,
then smaller numeric GHSL id. `k` is independent of `alpha` and `R_i(alpha)`.

The computational grid is 1/30° (about 3.7 km at the equator). It uses the
minimum non-water friction in each 4-by-4 block of MAP 2019 pixels. Narrow
waterways and curved mountain routes can be shortened or connected by this
aggregation. There are no added ferry routes. Borders are closed except the
explicit owner-reviewed policy; an open border never creates a sea connection.
Coarse aggregation can treat waterways of roughly 7 km as connected, for
example Bali–Java, Negros–Cebu and Tierra del Fuego–the South American mainland.
This is an approximation rather than a strict width limit; diagonal connections
can span wider water. Ferries themselves are not included.
Routing follows Natural Earth's default control view while display follows the
Mundus view. Disputed cells are hatched without an ownership label. Unknown
land-country cells inherit the nearest routing label deterministically.

The complete open-pair and pseudo-unit policy, sources, clipping rules,
limitations and reproducibility requirements live in
[docs/data/city-reach.md](data/city-reach.md). All displayed names still obey §5.
Every territory owner, parent and component root needs a nonempty English
display name. Missing reviewed Chinese city names remain null and fall back to
English in the Chinese interface; the manifest and name report count them.
All asset countries need reviewed Chinese names, and Chinese duplicates fail
unless both assignments are reviewed overrides.

As `k` increases, a point's owning population can only increase. Every
territory component contains one of its owner's source cells. Multi-cell
sources can still yield disconnected territories; holes and ring-shaped
surrounding regions are possible. Neither claim means whole urban areas are
annexed in one step. The centre-assignment threshold
`k_c(i) = min_j T(c_i, S_j) / log10(P_j / P_i)` over larger cities describes
only the centre cell. Parent populations strictly increase, forming a forest.

The field distinguishes finite thresholds, transport-component roots,
larger-but-unreachable cities, coarse-grid merges, missing transport and
disputed centres. These are not one ranking of the “most independent” cities.
Only finite thresholds may be ranked. Colour distinguishes owners; brightness
uses a separate GHS-POP 2020 density raster, not owner population. Neither
channel changes the underlying score.

RGB8 ownership images are prepared offline and loaded only for the selected
level, with one shared population-density image. Owner ids use R + 256·G and
B is zero; neither image carries data in alpha. All devices use the sole
stride-4 display resolution, about 15 km at the equator; CPU lookup and the
globe use the same samples. Computation stays on the original 1/30° grid,
so thresholds and parent cities are unchanged. The owner decided this on
2026-10-12, replacing proposal D5’s original 1/30° display. A higher display
resolution requires separate owner approval. Decoded CPU and GPU allocation,
rather than compressed download size alone, determines the memory budget. A failed new level keeps the previous
level visible with an explicit notice and a retry action. Exiting releases field
resources. The static view disables idle rotation but preserves manual rotation.

The existing geometric `d/R` worker field remains shipped until this
replacement's reviewed assets and frontend are released; it is then removed,
not retained as another user-facing algorithm.

## 4. Asset

The city view uses one generated JSON, loaded lazily as a dynamic-import chunk
when that view is entered: `src/data/generated/urban-isolation.json`. It contains:

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
  `巴勒斯坦` for Palestine. The owner-approved display labels are
  `塞尔维亚（科索沃）` for Kosovo and `塞浦路斯（北部）` for Northern Cyprus,
  consistent with the map's drawing-country view; routing uses separate labels.
- The executor never invents translations. With no reviewed Chinese city name,
  the Chinese UI shows the English name. A missing Chinese name is a recorded
  state, not an error. A centre with an empty GHSL main name remains in the
  competitor universe; if referenced by a focal record-holder list, the build
  requires an override supplying a nonempty `nameEn`; Chinese may remain null.

## 6. Interaction

- Entry: tier `primary`, alongside Other Side and Surname Atlas. Sunline remains
  under "更多观察".
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
  - an independent native radio group chooses `k`; the α slider and geometric
    Top 10 remain in the city view;
  - territory owners are shown by the travel-cost rule in §3; disputed cells
    are hatched, unreachable land is neutral, and oceans have no region fill;
  - the selected point reports its owner and country, centre threshold and
    parent, or its explicit missing/root/merge state;
  - a keyboard-accessible city selector includes reviewed field cities;
  - a centre with no larger reachable city is labelled “所在陆块/岛屿（交通连通区域）中人口最大的城市” / “Largest city on its landmass or island (transport-connected area)”; closed borders can divide a landmass;
  - known limitation: the selected point’s ownership chain across all seven
    levels (for example Dongguan → Guangzhou) is not shown in this version.
    Only the current level is loaded; the centre threshold/parent forest is
    a separate observation and does not substitute for that point’s chain;
  - the static view does not use idle rotation, but keeps manual globe
    rotation and selection.
- URL: `mode=isolation&point=…&alpha=0.37&view=field&reach=8&v=2`.
  - `alpha` has two decimals and is omitted at the 0.50 default.
  - `view=field` is emitted only for the global field view; city view is the
    default.
  - Invalid or out-of-range values fall back to 0.50.
  - `reach` records only a nondefault approved level. Invalid values return to 4.
  - `alpha` keeps its existing semantics and value when switching to field; it
    does not change field ownership.
  - Slider and reach moves replace history; mode, view and point changes push one.
- Lazy loading: no isolation chunk or data request in the lobby or other
  modes. Field cities and ownership tiles load only upon entering field. A
  failed field request shows a local retry action and leaves city view usable.
- About: method notes and GHSL credit (CC BY 4.0 + citation); the replacement
  field adds MAP, GHS-POP and OpenStreetMap attribution before release.

## 7. Acceptance

Mathematics (unit tests):

- R(α) is non-decreasing.
- Every competitor satisfies the threshold.
- The competitor is the nearest eligible city: brute force agrees with the
  step lookup on random fixtures for α on a 0.01 grid.
- Ties follow §3; the no-competitor state appears exactly when expected.
- The completeness invariant holds.
- The replacement field solver agrees with independent shortest paths and
  exhaustive score comparisons, including deterministic ties.
- Population monotonicity, source-connected territory components and centre
  thresholds pass small-graph tests.
- PNG owner codes, tile seams and antimeridian lookup agree on CPU and GPU.
- Global audits use the approved ≥100,000-city universe, not research counts.

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

- entering via the primary observation switcher and lobby;
- lazy loading;
- choosing a ranked city;
- moving α changes competitor, ring and arc diagnostics at a known breakpoint;
- entering `view=field` loads the selected level only, changes ownership with
  `k`, preserves `alpha`, agrees between card and globe, and stops idle rotation;
- field keyboard selection, per-level sharing, failed-level retry and all
  missing/root/disputed states;
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
