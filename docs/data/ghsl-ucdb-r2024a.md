# GHSL GHS-UCDB R2024A

## Source and licence

Urban Isolation uses the Global Human Settlement Layer Urban Centre Database
GHS-UCDB R2024A, V1.1, the fixed 2025 urban-centre population edition from
the European Commission Joint Research Centre (JRC).

- Dataset page: <https://human-settlement.emergency.copernicus.eu/ghs_ucdb_2024.php>
- JRC catalogue: <https://data.jrc.ec.europa.eu/dataset/1a338be6-7eaf-480c-9664-3a8ade88cbcd>
- DOI: `10.2905/1a338be6-7eaf-480c-9664-3a8ade88cbcd`
- Version: `V1_1`; release date: `31/07/2025`
- Global package: `GHS_UCDB_GLOBE_R2024A_V1_1.zip`
- Download URL: <https://cidportal.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_UCDB_GLOBE_R2024A/GHS_UCDB_GLOBE_R2024A/V1-1/GHS_UCDB_GLOBE_R2024A_V1_1.zip>
- Package size: 308,422,915 bytes
- Package SHA-256: `7b644df16b0791f88c3db28ce56338b5e1725be02b6a79ca253849822db26b21`

The official dataset page lists the use condition as **“Creative Commons
Attribution 4.0 International”** and explains: **“CC BY 4.0 lets others
distribute, remix, tweak, and build upon the author’s work, even commercially,
as long as they credit the author for the original creation.”**

The V1.1 package README gives this citation:

> Mari Rivero, Ines; Melchiorri, Michele; Florio, Pietro; Schiavina, Marcello;
> Goch, Katarzyna; Politis, Panagiotis; Uhl, Johannes H; Pesaresi, Martino;
> Maffenini, Luca; Sulis, Patrizia; Crippa, Monica; Guizzardi, Diego; Pisoni,
> Enrico; Belis, Claudio; Jacome Felix Oom, Duarte; Branco, Alfredo; Mwaniki,
> Dennis; Kochulem, Edwin; Githira, Daniel; Carioli, Alessandra; Ehrlich,
> Daniele; Tommasi, Pierpaolo; Kemper, Thomas; Dijkstra, Lewis (2024):
> GHS-UCDB R2024A - GHS Urban Centre Database 2025. European Commission,
> Joint Research Centre (JRC) [Dataset] doi:
> 10.2905/1a338be6-7eaf-480c-9664-3a8ade88cbcd PID:
> http://data.europa.eu/89h/1a338be6-7eaf-480c-9664-3a8ade88cbcd

## Capture input

The V1.1 global ZIP contains a GeoPackage rather than a single CSV. The
capture input was exported from its two official tables into a temporary CSV;
the raw download remains outside Git. The derived capture CSV has 11,422 rows,
is 680,826 bytes, and has SHA-256
`c122f1fdc8a9da3fdbe83ddb356fadf28b6baa305d7f0d04cce0fde9649ab2d4`.

This CSV is a local export, not a separately published distribution. The
manifest's `sourceAssets.zip` pairs the official ZIP URL with its ZIP hash;
`derivedCapture` records the exported CSV filename, hash, byte size and export
recipe. The two hashes identify different files and must not be interchanged.

To reproduce the capture CSV, join
`GHS_UCDB_THEME_GENERAL_CHARACTERISTICS_GLOBE_R2024A` with `UC_centroids` on
`ID_UC_G0`, select the six columns below in their listed order, and order by
numeric `ID_UC_G0`. The general-characteristics table's relevant column names
and text values start with U+FEFF; remove that leading marker from the exported
header and text values. Write the results with Python's standard `csv.writer`
as UTF-8, using its CRLF record terminator. This reproduces the pinned CSV hash
from the official GeoPackage without changing numeric values.

The exact columns used are:

| CSV column        | Meaning                                                      |
| ----------------- | ------------------------------------------------------------ |
| `ID_UC_G0`        | GHSL urban-centre identifier                                 |
| `GC_UCN_MAI_2025` | Main urban-centre name                                       |
| `GC_CNT_GAD_2025` | Country name                                                 |
| `GC_POP_TOT_2025` | Total population, 2025 epoch                                 |
| `GC_UCC_LON_2025` | Centroid x, Mollweide metres (despite the source field name) |
| `GC_UCC_LAT_2025` | Centroid y, Mollweide metres (despite the source field name) |

No ISO country-code column is present; the generated input records
`countryIso: null`.

The source centroid table is EPSG:54009 World Mollweide. With `R = 6378137`
metres and central meridian `lambda_0 = 0`, the export converts coordinates
using:

```text
theta = asin(y / (sqrt(2) * R))
lat = asin((2 * theta + sin(2 * theta)) / pi)
lon = pi * x / (2 * sqrt(2) * R * cos(theta))
```

The CSV retains the source x/y values in metres. The resulting latitude and
longitude are converted from radians to degrees and rounded to four decimal
places by the capture build.

## Thresholds and definitional caveats

- Competitor universe: population `>= 100,000`.
- Focal cities: population `>= 1,000,000`.
- The UI alpha range is `0.10` through `1.00`; the completeness invariant is
  `0.10 * min focal population >= 100,000`.

Capture rejects missing, non-finite or non-positive populations and missing or
invalid centroids. Rows below 100,000 are filtered; unnamed rows at or above
100,000 remain in the immutable input (including unnamed focal rows). An
unnamed row may remain absent from the compact asset when it is not referenced
by any focal record-holder list; if it becomes a referenced competitor, the
build fails unless a reviewed name override supplies its labels.
The offline build verifies the immutable input hash and the bundled GeoNames
snapshot hash before rebuilding. `pnpm data:verify` checks both the immutable
input and the derived Urban Isolation asset.

Distances use a sphere of radius 6371.0088 km. Compared with a WGS84 ellipsoid,
the great-circle approximation can differ by less than 0.5%.

The optional global field view applies these distances to each focal centre's
current isolation radius. A land point x is assigned to the focal centre that
minimises `d(x, centre) / R(α)`, where R(α) is the nearest qualifying
competitor distance at the selected α. This weighted spherical Voronoi rule
allows curved, irregular borders and is evaluated against the existing Natural
Earth land surface. It does not model terrain, roads, travel time,
administrative territory or accessibility. Centres whose R(α) is undefined or
zero remain selectable points but do not own a region. Colours identify the
categorical owner only; they are not another population or isolation scale.
Because R(α) is a step function of the qualifying population threshold, region
borders change at those steps and remain unchanged between them; the method
does not interpolate weights across thresholds.

The field uses a lazy Web Worker to build conservative tile candidate lists
for exact fragment-shader evaluation. Candidate tiles are an acceleration
structure rather than a rasterised boundary. The worker and field textures are
released when the field view or α changes, and a failed build is reported as a
local retryable state. The static field view stops automatic idle globe
rotation while preserving manual rotation and city selection.

The method note preserves the three effects from the accepted design:

1. Adjacent cities can merge into one urban centre, removing them as each
   other’s competitors.
2. Populations are modelled grid estimates for 2025, not census counts.
3. The centroid of a large or irregular urban centre can sit away from its
   historic centre.

Additional known limitations:

- GHSL can classify densely populated rural areas as urban centres. For
  example, Hajipur in Bihar, India has a modelled 2025 population of about
  9.8 million in this dataset.
- Some centres use the name of a smaller town within the footprint. Sarvestan
  in Iran has about 1.0 million people in the 2025 data.

Urban Isolation preserves both source records and populations without
correcting them to municipal boundaries or census counts.
