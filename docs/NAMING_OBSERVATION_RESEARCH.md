# Naming Observation Research

Status: research complete; bounded Surname Atlas implementation is being
extended with a pinned Iran community supplement and tested label-layout
contract before the next protected-main release validation

Updated: 2026-09-22, Asia/Shanghai

## Recommendation

Use a small community-sourced naming observation as the next product packet,
starting with surnames. The first question should be:

> What common surname record does this country have in the reviewed community
> dataset, and how is it written in local and Latin forms?

This is a source-indexed cultural observation, not a globally comparable census
ranking. The product must say when a country has no comparable record or when a
field is missing.

Given-name data can follow as a separate lens after the surname contract is
working. Its country coverage and meaning are different and should not be
silently merged with surname frequency.

## Candidate Source

`sigpwned/popular-names-by-country-dataset` is a practical low-resource source:

- repository: <https://github.com/sigpwned/popular-names-by-country-dataset>;
- release: v1.2, published 2023-07-16;
- repository data declaration: CC0;
- surname CSV: about 96 KB, 2,576 rows, 75 country codes;
- given-name CSV: about 124 KB, 2,278 rows, 106 country codes;
- source snapshot stated by the author: Wikipedia lists collected during the
  week of 2023-07-08;
- fields include country, rank, localised name, romanised name, count, and
  percentage when available.

The upstream surname file has a `Rank=1` record for 72 of 75 countries in this
early input snapshot. Albania, Bosnia and Herzegovina, and Greece have no
rank-one record in that snapshot. Some countries have multiple rank-one
spellings or transliterations. Counts and percentages are frequently absent.
The current derived asset extends this baseline with the separately pinned Iran
community supplement and preserves source-listed unranked rows, so its final
counts are documented in the implementation packet below.

The repository's CC0 declaration does not erase the need to preserve upstream
provenance. Its README identifies Wikipedia list pages as the source, and those
pages are CC BY-SA 4.0. A production asset must retain the upstream page URLs,
the repository version, the collection date, the transformation, and both
license statements. A small manually reviewed derivative is preferable to
blindly treating the CSV as an authoritative global table.

The current asset also includes one separately sourced Iran record from
[`farbodbj/iranian-surname-frequencies`](https://github.com/farbodbj/iranian-surname-frequencies):

- repository license: Apache-2.0;
- pinned source commit: `9fb2fdccb62445b52e933d4d7929a52e01bd6011`;
- pinned CSV SHA-256:
  `e71a59fd87e0da0fc6aeef8b44ed6c3b2b4c00adc2ade0d51af5a58281b34de7`;
- top row: `محمدی` / `Mohammadi`, frequency `0.0085581142730807`;
- the README describes a 10-million-record-derived Persian sample, but does
  not establish a national census frame or a collection year;
- the record is therefore shown as an explicit rank-one community sample for
  Iran and is not compared numerically with the Wikipedia-derived rows.

## Data Contract

The reviewed asset retains rank-one records as the primary finding and keeps
source-listed rows without a numeric rank only for countries that have no
rank-one record. Those rows are explicitly unranked rather than promoted to a
global ranking. It uses a schema equivalent to:

```text
countryIso: string
rank: number | null
localForms: [{ value: string, script: string | null }]
romanizedForms: string[]
zhDisplay: string | null
zhMethod: "reviewed" | "source" | "missing"
count: number | null
share: number | null
statYear: number | null
sourceKind: "community" | "wiki-derived" | "official"
sourceUrl: string[]
license: string
sourceSnapshot: string
coverageNote: string
confidence: "reviewed" | "source-only" | "missing"
```

`rank=1` is an array of records, not a single string; an unranked source list
uses `rank: null`. `count`, `share`,
`statYear`, `zhDisplay`, and transliteration remain nullable. Missing values
must not become zero, and a missing rank-one record must not be filled by
guessing from another source.

The user-facing label should be “common surname record” or
“source-listed highest-frequency surname”. Use “Chinese presentation” rather
than “Chinese translation”: a Chinese form may be an established name, an
音译, or unavailable. Do not generate an official-looking Chinese name from
Google Translate at runtime.

## Alternative Sources

The U.S. Census 2010 surname release is a clean official single-country source:

- <https://www.census.gov/topics/population/genealogy/data/2010_surnames.html>;
- 162,253 surnames occurring at least 100 times;
- published rank and count, with technical documentation;
- top-1,000 workbook is under 0.1 MB; the complete archive is about 12.9 MB;
- use requires Census attribution and must remain explicitly US-only.

It is useful as an independently sourced US comparison or validation sample,
not as a way to make the community table globally uniform.

Wikidata has a CC0 structured-data policy but does not expose a single,
consistent country-by-country surname-frequency table. Wikipedia lists can be
used for provenance and manual review, not as a silently unified census.

`SMenigat/common-surnames` is an additional small MIT-licensed community list,
but its 13 country files are alphabetical surname inventories without counts or
rank fields. It can support a future explicitly unranked browse fallback; it
cannot safely fill a map label that claims to be the country's most common
surname, so it is not merged into the rank-one asset.

Do not use Forebears as a redistribution source without a separate license
decision. Do not use `philipperemy/name-dataset`: its provenance includes a
Facebook data leak and its full data has multi-gigabyte storage and memory
requirements. Do not use unprovenanced country frequency repositories merely
because their repository license is permissive.

## Coverage Audit (2026-09-22)

The v1.2 source snapshot has 75 country codes; the Iran and Sweden supplements
add one country entry each, for 77 generated entries. A review of the current
Natural Earth 110m country features found 177 geometries, so the snapshot is
intentionally incomplete.
The missing-geometry list must not be treated as a list of missing surnames:
some countries do not use stable family surnames, and several public lists only
describe a city, an ethnic group, or an unranked set of examples.

One additional country has a directly usable ranked record in the reviewed
Wikipedia source page. The Sweden section lists `Andersson` as rank 1 with
251,621 individuals and cites Statistics Sweden's `Namnstatistik` table
(dated 2013-09-15). The page is CC BY-SA 4.0 like the other Wikipedia-derived
source material. The raw page used for this audit was 127,970 bytes with SHA-256
`c5fbe91365197c28ab8b3c200ce69ef08ea0bf098b9dc81ba2c77e9cd0dff60b`:

- <https://en.wikipedia.org/wiki/List_of_most_common_surnames_in_European_countries>
- <http://www.scb.se/Pages/TableAndChart____31063.aspx>

The Sweden row is now included in the generated asset as a pinned, manually
reviewed supplement with both source URLs; the builder output schema remains
unchanged. It contributes one rank-one map label, while its 2012 count remains
explicitly separate from the primary community snapshot.

The same page does not justify several tempting additions. Bosnia and
Herzegovina is split into Bosniak and Serb lists rather than a country-wide
ranking. Belarus reports Minsk only, and Switzerland reports German-speaking
cantons only. Those records must not be promoted to country-level rank 1.
The Asian page says that most Indonesians and Malaysians do not use family
names, describes Thai surnames as legally unique, and gives Pakistan only an
unranked `Khan` note. These statements are useful coverage caveats, but they do
not support a map label claiming a national highest-frequency surname. No
redistribution-safe, country-wide ranked source was found for the reviewed
African gaps during this audit. `SMenigat/common-surnames` remains an
alphabetical MIT-licensed inventory and is therefore still unsuitable for a
rank-one map label.

## Product Packet Boundary

An implementation packet should contain one static JSON asset under 0.2 MB,
reuse the existing country identity and globe, and add no backend, crawler,
runtime translation service, or new renderer. The initial interaction can be:

1. select a country on the globe or from the existing place context;
2. read the source-listed common surname record;
3. switch between local form, Latin form, and reviewed Chinese presentation;
4. inspect rank, year, coverage, source, and missing-state disclosures.

The packet must include manually reviewed Chinese forms for its chosen launch
set. Countries without a reviewed Chinese form show an explicit unavailable
state. Any country with multiple rank-one entries shows all of them.

Acceptance requires deterministic asset hashing, source and license notices,
desktop/mobile semantic output, keyboard access, reduced-motion behavior, and a
measured Pages transfer/runtime budget. No global crawl or large source dump is
part of the packet.

## Implementation packet

The implementation uses `src/data/generated/surnames-by-country.json` and
`src/features/surnames/`. The asset has 241 country entries; 198 carry 288
records (74 rank-one, 144 source-listed and 70 manual observations), and all
195 sovereign countries have a record. It is 93,515 bytes before compression
and loads only when the mode is active. The manifest pins the primary CSV,
the Statistics Sweden, Iran and African supplements, the Wikipedia raw page
used to review Sweden, and the ISO mapping hash.

The 70 manual observations cite only the general Wikipedia index without
pinned per-record evidence. On 2026-10-07 the product owner accepted shipping
them as they are, with each labelled in the result panel as manually compiled
and not individually verified; pinning per-record evidence remains a possible
later improvement.

Chinese presentations are limited to five manually reviewed forms (`CN`,
`TW`, `KR`, `JP`, `VN`), Han-script source forms, and a small curated table of
established transliterations. Every other record shows an explicit missing
state; Chinese map mode then falls back to the source spelling and says so.
The app preserves alternate local and romanized forms within a source group
and does not infer a statistical year from the 2023 collection snapshot.

Every country with a record receives one straight wordmark from the slot
table `src/data/generated/surname-label-slots.json` (schema 7). Wordmarks
stay inside their own country, follow the local parallel by default, and
rotate along the principal axis only for elongated countries when that makes
the word materially larger. The slot table and the 50m geometry it is built
on load only with the Surname Atlas. Countries without a usable slot keep
their record in the side result but have no map wordmark.
