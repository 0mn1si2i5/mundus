# People in a Circle: population grid and method

People in a Circle (`circle`, under "More observations") answers one question
for the selected place: how large a circle around it must be to hold half the
world's people. A slider sets any other radius; the result then gives the
people inside and their share of the world.

## Source and licence

The observation reuses the pinned GHS-POP R2023A V1-0 2020 snapshot that
Reshaped Earth already aggregates: WGS84, 30 arcseconds, ZIP SHA-256
`579fb7477b33d9be61e9562b170ea108a670b85ef6fe23b61a22d17200929636`
(`scripts/reshaped-earth/sources.mjs`). Licence: CC BY 4.0. Citation:
Schiavina, M., Freire, S., Carioli, A., MacManus, K. (2023), _GHS-POP R2023A -
GHS population grid multitemporal (1975-2030)_, European Commission, Joint
Research Centre (JRC), DOI `10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE`.
No new source or licence was added; the About dialog names this use beside
Reshaped Earth.

## Published grid

`pnpm data:population-circle` reads the source in row stripes and sums every
pixel into the 0.25° cell (1440 × 720, row 0 at 90°N, column 0 at 180°W) that
contains its centre. Longitudes that overhang the antimeridian wrap. Sums are
Kahan-compensated and must equal the source total within a relative `1e-9`;
the total must lie within 2% of 7.8 billion. Each cell is rounded to whole
persons, or to tens if a cell would exceed 24 bits (the 2020 maximum is about
14.7 million, so the unit is 1). Counts are stored as an RGB8 PNG
(`R × 65536 + G × 256 + B`) and decoded in the browser without a canvas.

Accepted build (2026-10-21, on the owner's machine, 143 s, 490 MB peak
resident memory, reusing the existing extraction in
`~/.cache/mundus-data/reshaped-earth/`):

| Field                | Value                         |
| -------------------- | ----------------------------- |
| Source total         | 7,840,952,947                 |
| Published total      | 7,840,952,200                 |
| Populated cells      | 164,963                       |
| PNG                  | 419,909 bytes (budget 1.2 MB) |
| Smallest half circle | 28.65°N, 100.6°E, 3,343 km    |

`pnpm data:verify` checks the pin, hash, size budget, exact published total,
populated-cell count and rounding drift, and recomputes the smallest half
circle with the browser code.

## Method

`src/features/circle/circleProfile.mjs` is shared by the build and the
browser. For a centre it computes the great-circle distance to every
populated cell centre (chord formula, exact near the centre), sums people into
1 km bins out to half the circumference, and interpolates linearly inside a
bin. The half radius is the first radius whose cumulative population reaches
half the world. Cells count wholly by their centre, so below about 200 km the
result is labelled rough. Radii are shown to 10 km (5 km below 100 km).

The smallest half circle is found offline: a 2° candidate lattice between
59°S and 79°N is ranked on a 2° coarse grid, the 24 best are refined on the
published grid at 0.25° (±2°), and the best is refined again at 0.05°. It is the
smallest circle for this grid and method, not a unique geographic truth.

## URL and display

`v=2&mode=circle&point=…` opens the half circle. `radius=<whole km>` (50 to
20,000) is written only after the slider is used; invalid values fall back to
the half circle. Slider changes replace the history entry. The globe draws
log-scaled density, a paper veil outside the circle and a ring; a new centre
grows the circle over 0.8 s except under reduced motion.

## Rebuild

```bash
pnpm data:population-circle
pnpm test:data-population-circle
pnpm data:verify
```

The build reuses `fetchSource('population')` and the ZIP extraction under the
Reshaped Earth cache (`MUNDUS_DATA_CACHE`), so a machine that has rebuilt
Reshaped Earth downloads nothing. It runs single-threaded in a few minutes and
writes only the PNG and manifest in the worktree.
