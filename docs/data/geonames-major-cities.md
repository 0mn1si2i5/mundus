# GeoNames major-city index

The Other Side autocomplete and bilateral nearest-major-city relation use a
reviewed GeoNames snapshot captured together at `2026-08-01T09:39:05.688Z`
(`2026-08-01 17:39:05.688` Asia/Shanghai). All five official source files are
pinned by captured SHA-256 and HTTP identity in
`src/data/manifests/geonames-major-cities.json`; raw archives remain ignored.

Candidate A retains every active `PPLA` and `PPLC`, plus active `PPL`, `PPLA2`,
`PPLA3`, `PPLA4`, and `PPLG` records with population of at least 100,000.
Coordinates, a non-empty admin-1 code, and exact ISO2 country/admin-1 joins are required. Historic,
colloquial, expired, abandoned, destroyed, and `PPLX` records are excluded.

English and Chinese labels are selected deterministically from current source
names. Only existing `zh-CN`, `zh-Hans`, and `zh` strings are converted from
OpenCC traditional Chinese to Simplified Chinese with `opencc-js` 1.4.1 using
`{ from: 't', to: 'cn' }`. Every distinct accepted original Chinese form and
every distinct simplified derivative remains searchable. Only additional
non-display English aliases are capped at two. No non-Chinese name is
translated. Missing Chinese names remain explicit canonical fallbacks.
A Chinese-language value is a display candidate only if it contains Han
characters; romanized values in Chinese-language records (for example
`Duīlóngdéqìng Qū`) remain searchable aliases. A value that joins two variants
with `or` (`臺灣省 or 台灣省`) keeps its first variant. The build fails if a
selected Chinese city, country or admin-1 label still contains Latin letters.
Runtime format 2 stores that provenance explicitly in row flag bit 0; reserved
bits are rejected. Chinese search results mark canonical fallbacks as
`GeoNames 原名（暂无中文名）`, while real Chinese labels and English results do not.

The compact index has 6,953 ID-sorted rows, E5 coordinates, a lexical string
table, complete accepted Chinese aliases, bounded additional English aliases,
and one integer flag bitset per row. Of those rows, 3,862 have real Chinese
labels and 3,091 use canonical fallbacks. The committed asset is 793,897 raw
bytes and 277,446 gzip bytes. Its static decoded estimate is 3,175,588 bytes.
Including decoder-precomputed,
deduplicated normalized display/country/admin/alias fields, per-city search
objects, and alias references, the conservative runtime total is 4,819,872
bytes, below the 8 MiB gate. Its SHA-256 is
`44fa1d6c1d2226b0fc1381318710f19833f4fb2ef970902c9dde89f41cd5ca28`.

The redistributed CC BY 4.0 immutable build input uses schema 2 and is 2,814,375
bytes with SHA-256
`49b3f2114d1e71277572b2773cb1e5b8242f3eb22a9e89598eb95b79408c5621`.
It contains only normalized upstream fields and rows required to regenerate the
runtime result exactly; empty alternate-name groups and redundant nested
GeoNames IDs are omitted. The five ignored raw files total 205,999,947 bytes,
including the 202,504,032-byte alternate-names archive.

Run `pnpm data:cities` from a clean checkout for a deterministic offline build
from that verified tracked input. Run `pnpm data:cities:capture` only for a
reviewed refresh of all five rolling official inputs. Capture downloads to
an ignored unique staging directory, records hashes from the bytes actually
received, and keeps that source directory immutable through verification,
extraction, generation, and tracked publication. It publishes the input and
runtime before the manifest and rolls the prior complete generation back on a
forward replacement failure. If rollback itself fails, every restore is still
attempted, errors are aggregated, and recoverable staging/backups are retained.
The rolling URLs alone are not a rebuild identity.

The visible relation searches this same immutable index independently from the
exact origin and exact antipode. Results mean nearest eligible represented
major city, not nearest settlement, administrative boundary, or built area;
distance ties retain the index's deterministic population and GeoNames ID
ordering.
