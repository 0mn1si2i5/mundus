# Third-party licenses

Mundus source code is licensed under the repository's [MIT License](LICENSE).
That license applies to Mundus code only. Third-party software and data retain
their own copyright and license terms.

## Runtime software inventory

This is the complete production dependency graph resolved by `pnpm-lock.yaml`
on 2026-07-16. It is intentionally conservative: optional dependencies in the
installed production graph are listed even when a particular build may remove
them. Regenerate the inventory with `pnpm licenses list --prod --json` and
review any diff whenever the lockfile changes.

The applicable standard texts are [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0),
[BSD 3-Clause](https://opensource.org/license/bsd-3-clause),
[ISC](https://opensource.org/license/isc-license-txt), and
[MIT](https://opensource.org/license/mit). Package-specific copyright notices
and source links are available from `pnpm licenses list --prod`. Vite generates
`THIRD_PARTY_NOTICES.md` from the exact packages included in each production
bundle. Three packages that declare MIT but omit a license file from their npm
archive have explicit, reviewed notice overrides under `scripts/`. The build
fails if any bundled entry still lacks license text, then publishes the
complete notices together with this conservative inventory and the Mundus MIT
license.

### Apache-2.0 (5 resolved package versions)

- `@dimforge/rapier3d-compat@0.12.0`
- `@mediapipe/tasks-vision@0.10.17`
- `draco3d@1.5.7`
- `hls.js@1.6.16`
- `promise-worker-transferable@1.0.4`

### BSD-3-Clause (1 resolved package version)

- `ieee754@1.2.1`

### ISC (8 resolved package versions)

- `d3-array@3.2.4`
- `d3-geo@3.1.1`
- `internmap@2.0.3`
- `isexe@2.0.0`
- `potpack@1.0.2`
- `topojson-client@3.1.0`
- `which@2.0.2`
- `world-atlas@2.0.2`

### MIT (58 resolved package versions)

- `@babel/runtime@7.29.7`
- `@monogrid/gainmap-js@3.4.0`
- `@react-three/drei@10.7.7`
- `@react-three/fiber@9.6.1`
- `@tweenjs/tween.js@23.1.3`
- `@types/draco3d@1.4.10`
- `@types/offscreencanvas@2019.7.3`
- `@types/react-reconciler@0.28.9`
- `@types/react@19.2.17`
- `@types/stats.js@0.17.4`
- `@types/three@0.185.1`
- `@types/webxr@0.5.24`
- `@use-gesture/core@10.3.1`
- `@use-gesture/react@10.3.1`
- `base64-js@1.5.1`
- `bidi-js@1.0.3`
- `buffer@6.0.3`
- `camera-controls@3.1.2`
- `commander@2.20.3`
- `cross-env@7.0.3`
- `cross-spawn@7.0.6`
- `csstype@3.2.3`
- `detect-gpu@5.0.70`
- `fflate@0.6.10`
- `fflate@0.8.3`
- `glsl-noise@0.0.0`
- `immediate@3.0.6`
- `is-promise@2.2.2`
- `its-fine@2.0.0`
- `lie@3.3.0`
- `maath@0.10.8`
- `meshline@3.3.1`
- `meshoptimizer@1.1.1`
- `path-key@3.1.1`
- `react-dom@19.2.7`
- `react-use-measure@2.1.7`
- `react@19.2.7`
- `require-from-string@2.0.2`
- `scheduler@0.27.0`
- `shebang-command@2.0.0`
- `shebang-regex@3.0.0`
- `stats-gl@2.4.2`
- `stats.js@0.17.0`
- `suspend-react@0.1.3`
- `three-mesh-bvh@0.8.3`
- `three-stdlib@2.36.1`
- `three@0.185.1`
- `troika-three-text@0.52.4`
- `troika-three-utils@0.52.4`
- `troika-worker-utils@0.52.0`
- `tunnel-rat@0.1.2`
- `use-sync-external-store@1.6.0`
- `utility-types@3.11.0`
- `webgl-constants@1.1.1`
- `webgl-sdf-generator@1.1.1`
- `zod@4.4.3`
- `zustand@4.5.7`
- `zustand@5.0.14`

## Data

| Material                        | Version                                                  | Terms                                                                                                                                              | Attribution                                                                   |
| ------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Natural Earth Admin 0 countries | 4.1.0 through `world-atlas` 2.0.2                        | Public domain                                                                                                                                      | Made with Natural Earth                                                       |
| GeoNames major-city snapshot    | Captured 2026-08-01T09:39:05.688Z                        | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)                                                                                          | Contains GeoNames data, licensed under CC BY 4.0                              |
| Community surname observation   | Popular Names by Country v1.2                            | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) plus upstream [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) provenance | Community-compiled source-listed surname records; see `DATA_SOURCES.md`       |
| Iranian surname supplement      | `farbodbj/iranian-surname-frequencies` commit `9fb2fdcc` | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)                                                                                          | Iran rank-one record from a community frequency sample; see `DATA_SOURCES.md` |
| African surname observations    | Pulse Nigeria article, retrieved 2026-09-23              | Factual country/surname pairs only; article text is not redistributed                                                                              | One source-listed surname per listed African country; see `DATA_SOURCES.md`   |
| GHSL Urban Centre Database      | GHS-UCDB R2024A V1.1                                     | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)                                                                                          | Urban Proximity city centres and 2025 populations; see `DATA_SOURCES.md`      |

Natural Earth source and terms are documented at
<https://www.naturalearthdata.com/about/terms-of-use/>. Exact source URLs,
hashes, transformations, and caveats are in [DATA_SOURCES.md](DATA_SOURCES.md)
and `src/data/manifests/`.

The redistributed GeoNames material includes both the normalized immutable
build input and its compact runtime index. Both remain under CC BY 4.0 with the
attribution above; the large raw rolling downloads are not redistributed.

## Build-only software

- `opencc-js@1.4.1`, pinned in `pnpm-lock.yaml`, is used only by the GeoNames
  generator with the OpenCC `t` to `cn` dictionaries. It is not imported by the
  application runtime or production bundle. npm declares `MIT AND Apache-2.0`;
  source and notices are at <https://github.com/nk2028/opencc-js>.

`meshoptimizer@1.1.1` is also used at runtime to decode the lazy Natural Earth
vector globe buffers. It is MIT licensed; its exact bundled notice is emitted
to `THIRD_PARTY_NOTICES.md` by the production build.

## Solar method

Sunline implements mathematical approximations described by NOAA; it does not
redistribute a NOAA dataset. The method reference and limitations are recorded
in [DATA_SOURCES.md](DATA_SOURCES.md).
