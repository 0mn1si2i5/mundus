# Land borders for Border Hop

Border Hop answers one question: without boats or planes, how many borders lie
between two countries or territories? It reads one small derived asset,
`src/data/generated/land-borders.json`, rebuilt by `pnpm data:land-borders`
from the pinned high-detail Mundus country topology
(`src/data/generated/mundus-countries-50m.json`, Natural Earth 5.1.2, public
domain). `pnpm data:verify` rebuilds it and fails if a single byte differs.

## Model

- **Land parts.** Every unit is split into its separate polygons, numbered by
  spherical area; part 0 is the largest. A route can leave a unit only from
  the part it entered. Exclaves and overseas territories are therefore real
  but isolated pieces: French Guiana makes France a neighbour of Brazil, yet it
  does not join South America to Europe; Ceuta and Melilla make Spain a
  neighbour of Morocco without a land route from Madrid.
- **Borders.** Two parts of different units border each other when they share
  a TopoJSON boundary arc. A shared point alone is not a border (this drops the
  false Namibia–Zimbabwe quadripoint).
- **Water-only boundaries (2026-10-21).** Country polygons cover lakes, so a
  shared arc can lie entirely in water. Every shared arc was checked against
  the Natural Earth 1:10m lakes layer (a review aid, not a shipped input): only
  DR Congo–Tanzania, along Lake Tanganyika, has no land at all, and it is
  removed. Pairs that also share land (Uganda–Tanzania at Lake Victoria,
  Malawi–Tanzania at Lake Malawi and others) stay neighbours. Nigeria–Chad,
  across the largely dry bed of Lake Chad, stays a land border as the source
  draws it.
- **Reviewed borders (2026-10-21).** The simplified geometry loses two real
  land borders, added explicitly: China–Macao (Barrier Gate, a hairline gap in
  the source) and Botswana–Zambia (Kazungula, about 150 m, a point in the
  source).
- **Fixed links (2026-10-21).** Seven bridges and tunnels join otherwise
  separate landmasses: Channel Tunnel (UK–France), Øresund Bridge
  (Denmark–Sweden), Great Belt Fixed Link and Little Belt Bridge (within
  Denmark), Bosphorus bridges (within Turkey), Johor–Singapore Causeway and
  King Fahd Causeway (Bahrain–Saudi Arabia). Each side is identified by a point
  inside the land part, and the build fails if a point stops resolving to
  exactly one part. Ferries are never modelled. Every listed link reaches an
  island or joins two separate land parts of one country. Links whose two ends
  already lie on one landmass are left out on purpose, not by oversight: the
  Hong Kong–Zhuhai–Macao Bridge (Hong Kong and Macao already meet over land
  through China; adding it would turn Hong Kong to Macao from two crossings
  into one) and the Kerch Strait Bridge (Crimea is joined to the mainland by
  its isthmus, and the bridge lies in the disputed Crimea case that the
  boundary policy does not settle).
- **Crossings.** A route's length is the number of moves between different
  units. A fixed link inside one unit costs nothing. The start and destination
  may use any of their parts, so every distance is symmetric. Among equal
  routes, one is chosen deterministically by unit id order.

Only parts with at least one border or link are stored (202 parts in 164
units); a unit absent from the asset has no land route. Boundaries follow the
Mundus China-view boundary policy and are not a statement on territorial
status. The model says nothing about whether a crossing is open, legal or
passable.

## Runtime

The asset (about 11 KB) loads only when Border Hop is entered. Globe picking
uses the low-detail topology, so a start is always a low-detail unit; any of
the 239 high-detail units can be a destination. Units missing from the
low-detail globe (for example Andorra) are still part of every route and are
listed in the result even when the globe cannot colour them.

The destination is shared as `to=<unit id>` (`ne-` plus the ISO 3166-1 numeric
code, or an explicit exception such as `ne-x-bir-tawil`). An id outside the
reviewed country-name table is ignored.
