# Mundus

[简体中文](README.zh-CN.md)

Mundus is a long-lived personal digital globe for looking at one planet through
different scientific lenses. It is designed as a small digital museum exhibit:
direct enough to explore, explicit about its methods, and careful about the
limits of its data.

The current implementation includes four observation modes. Other Side, Surname
Atlas and Urban Proximity are the primary observations; Sunline remains under
More observations:

- **Other Side** calculates exact antipodal endpoints and shows the nearest
  eligible major city to each endpoint in the bundled GeoNames snapshot. These
  are represented major-city results, not nearest settlements, boundaries, or
  built areas.
- **Surname Atlas** places one surname wordmark on every country that has a
  country-specific source record: the rank-one surname where a numeric rank
  exists, otherwise a source-listed or manually compiled common surname, each
  labelled as such. Wordmarks can be shown in the local script, a Latin
  transliteration, or Chinese (forms reviewed by Mundus). Wordmarks
  stay inside their own country and rotate along narrow countries. It uses
  community snapshots, not a unified official global ranking; missing fields
  remain explicit; each country links its source, and dataset licenses are in
  the About dialog.
- **Urban Proximity** shows the distance to the nearest GHSL urban centre that
  meets a visible population threshold α, with a ranked list and step chart.
  Distances are great-circle distances between urban-centre points, not travel
  accessibility. Its global field view partitions land by distance divided
  by each centre's current proximity distance, with a centre for each region.
- **Sunline** visualizes the day-night boundary and estimates solar position,
  sunrise, and sunset in UTC for educational use.

The public site is <https://0mn1si2i5.github.io/mundus/>. Deployment evidence
and known verification limits are recorded in [Implementation status](docs/IMPLEMENTATION.md).
The site follows `main`; formal versioned snapshots are listed in
[GitHub Releases](https://github.com/0mn1si2i5/mundus/releases).

## Run locally

Mundus uses Node.js 22.23.1 and pnpm 11.7.0 for the reproducible data and
release gates.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Before submitting a change, run the complete local gate:

```bash
pnpm check
pnpm test:e2e
```

`pnpm check` verifies formatting, lint, types, generated-data integrity, unit
tests, and the production build. Production source maps are deliberately
disabled for the V1 public artifact.

The product uses reproducibly generated Natural Earth vector spheres: low
quality loads 110m, while medium/high quality loads 50m. Country colors are
supplied by a small palette texture, and the existing raster globe remains the
loading and failure fallback.

## Data and licensing

The repository's MIT License covers Mundus source code only. Bundled datasets
and third-party packages retain their own terms. See [Data sources](DATA_SOURCES.md)
for provenance, transformations, attribution, and caveats, and
[Third-party licenses](THIRD_PARTY_LICENSES.md) for the dependency and data
license inventory.

Natural Earth boundaries are a cartographic representation, not a legal
authority on territorial status. Solar results are educational
interpretations and must not be used as legal, navigational, or engineering
advice.

## Repository layout

```text
src/
  app/           Application shell and responsive layout
  data/          Data manifests, generated snapshots, and registry
  features/      Globe kernel and domain-oriented modes
  i18n/          Chinese and English interface copy
  state/         Small cross-feature application state
  styles/        Global tokens and base styles
  test/          Unit-test setup
tests/e2e/       Real-browser release checks
tests/release/   Live deployment smoke tests
scripts/         Offline data builds and release verification
docs/            Product decisions and implementation evidence
.github/         CI and GitHub Pages workflows
```

Mundus is a static browser application with one shared 3D globe and no backend
or database. Its architecture and mode contracts are in
[Project plan](docs/PROJECT_PLAN.md). Generated data under `src/data/generated/`
includes both runtime assets and immutable inputs for offline rebuilding;
these are tracked release inputs. Raw downloads, research images, and local
test evidence belong outside the checkout. Dependencies and regenerable
build/test outputs are ignored by Git.

Security issues should be reported privately according to
[SECURITY.md](SECURITY.md).
