# Köppen-Geiger climate classes (Climate Twins)

Status: owner accepted the proposal on 2026-10-21 (historical 1991–2020 only;
future scenarios are out of scope for this edition).

## Question

Do places on the selected point's latitude share its climate, and where else
does the same climate occur? The mode answers with the point's Köppen-Geiger
class, its share of the world's land, up to three large cities on the same
latitude with a different climate, and up to three distant cities with the
same climate.

## Source and licence

| Field       | Value                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dataset     | Beck, H.E. et al. (2023), _High-resolution (1 km) Köppen-Geiger maps for 1901–2099 based on constrained CMIP6 projections_, Scientific Data 10, 724, <https://doi.org/10.1038/s41597-023-02549-6>       |
| Release     | figshare article 21789074, version 2, <https://doi.org/10.6084/m9.figshare.21789074>                                                                                                                    |
| Licence     | CC BY 4.0, read from the figshare article metadata on 2026-10-21                                                                                                                                        |
| Archive     | `koppen_geiger_tif.zip`, file 61012822, 130,618,411 bytes, figshare MD5 `7fc2f5a15d4f5fe0ce59c9a9b502aa09`, SHA-256 `bb84453d4541f1a0bc5a804ead83f483c19ce70f16a5197f6d3a7b6a63e65562`                  |
| Member used | `1991_2020/koppen_geiger_0p1.tif`, SHA-256 `59b749fe6711e72c720ff903044eb0efb4373524ee434740ed7384a0284c155b`; `legend.txt`, SHA-256 `2ede2ad270a036cc11c31705a2c1dbf0314a8cf011fc972cd4a9665e3339e5e5` |

GeoNames major cities reuse the existing snapshot
([geonames-major-cities.md](geonames-major-cities.md)); no new city source is
added.

## Transformation

- The published 0.1° (3600 × 1800) 1991–2020 GeoTIFF is used unchanged: no
  resampling and no reclassification. Values 1–30 are classes; 0 is water or
  no data. The build rejects any other value except the declared nodata.
- The archive legend must list exactly the 30 codes and RGB colours in
  `src/features/climate/koppenClasses.ts`, in order; any difference stops the
  build. Chinese and English class names are reviewed by Mundus.
- The class raster is published as an RGB PNG with the class in the blue
  channel (`src/data/generated/koppen-geiger/classes.png`, 254,082 bytes,
  247,360 gzip bytes); the manifest records its hash and the land share of
  each class, weighting cells by their spherical area.
- The browser verifies the PNG's size and SHA-256 before decoding it.

## Runtime rules

- A selected point or city on a water cell takes the nearest classified cell
  within two cells (about 20 km), by squared cell distance and then row-major
  order; otherwise it has no class. The card says when this happened.
- Same latitude: GeoNames major cities within ±1° latitude, at least 500 km
  away, with a different class; largest population first, one city per class,
  at most three. An ocean point lists cities on its latitude without a class
  comparison.
- Distant twins: cities with the same class at least 3,000 km away; largest
  population first, one per country, at most three. An empty list says so; the
  distance is never relaxed to fill it.
- The globe colours Natural Earth land with the dataset legend; once a point is
  classified, other classes are dimmed. Unclassified land is neutral grey. A
  latitude circle marks the selected point's latitude.

## Limits

These are climate-average types, not weather and not any single year. The
0.1° grid smooths mountains and coasts, and Köppen boundaries are thresholds
on monthly temperature and precipitation, so neighbouring classes can be close
in practice. Cities are compared only within the GeoNames major-city snapshot.

## Rebuild

The raw archive stays outside the worktree (for example
`~/mundus-raw/koppen/`, about 130 MB; remove it with
`rm -rf ~/mundus-raw/koppen` when no longer needed).

```bash
pnpm data:koppen --archive ~/mundus-raw/koppen/koppen_geiger_tif.zip --capture
pnpm data:koppen --archive ~/mundus-raw/koppen/koppen_geiger_tif.zip
pnpm data:verify
```

`--capture` prints the archive identity and legend and writes nothing.
Ordinary builds refuse an archive whose SHA-256 or size differs from
`scripts/koppen-geiger/source.mjs`.
