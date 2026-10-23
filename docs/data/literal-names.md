# Literal Names data contract

Literal Names (`mode=names`, under "More observations") writes on the globe
what each country's name literally says. The reviewed table is
`src/features/names/literalNames.ts`, one record per Mundus country unit
(`COUNTRY_NAMES`, 239 units), loaded as its own chunk only when the mode is
entered.

## Source and licence

- Backbone: the "Country name — etymology" field of the CIA World Factbook,
  final edition. The Factbook is a US government work in the public domain.
  It is read through the [factbook.json](https://github.com/factbook/factbook.json)
  mirror (CC0), pinned at commit
  `144d6977b2b01ac1cbd220de754c0a005616760b`; each record's `factbook` field is
  the mirror path (`region/gec`) of the entry it reviews.
- Every record is written by Mundus in its own words in Chinese and English.
  Factbook text is not copied verbatim into the UI.
- Wikipedia and other CC BY-SA text is not used as copy. Where a record departs
  from or adds to the Factbook, it lists the sources it follows in `sources`
  and explains the departure in `note`.
- Three units have no Factbook entry (Åland `ne-248`, Palestine `ne-275`,
  Bir Tawil `ne-x-bir-tawil`); their records must carry `sources`.
- A source marked `checked: 'search-summary'` could only be read through
  search excerpts from the build container. A reviewer should open it before
  the record's wording is strengthened.

## Record fields

| Field        | Meaning                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `local`      | The name in its own script; several official forms are separated by `" / "`, the first is drawn. |
| `lang`       | BCP 47 tag for `local`, used as the `lang` attribute.                                            |
| `confidence` | `established`, `likely`, `disputed` or `unknown`.                                                |
| `basis`      | `local` when the literal meaning reads the local name rather than the international one.         |
| `literal`    | Short wordmark text in Chinese and English.                                                      |
| `from`       | The words the name comes from.                                                                   |
| `note`       | Optional: competing readings or a correction to the Factbook.                                    |
| `zhKind`     | How the Chinese name renders it: `phonetic`, `semantic`, `mixed`, `native`, `abbreviated`.       |
| `zhNote`     | Optional: where the Chinese name comes from.                                                     |
| `sources`    | Further sources (https only), required when `factbook` is `null`.                                |

## Display rules

- `literal` must say what the name means, not repeat the name, and the
  Chinese and English texts must carry the same meaning.
- The globe draws a wordmark for every unit with a known meaning, in the
  interface language. A `disputed` record ends in "？" (Chinese) or "?"
  (English). An `unknown` record draws no literal wordmark; the result card
  says "meaning unknown".
- The `label=local` URL parameter switches every wordmark to the local name. It
  is written only when it differs from the default literal label.
- The result card shows confidence, the local form, the derivation, notes, the
  Chinese-name kind and links to the pinned Factbook entry and further sources.

## Loading

Entering the mode loads two chunks: the reviewed table (about 33 kB gzip)
and the shared wordmark runtime that Surname Atlas also uses
(`surnameAtlasRuntime`, with compact positions and exact-text radii). The lobby loads neither. Placement uses the shared offline
slot table for all 239 units; it does not load the 50m topology or search
polygons in the browser. Unrelated UI renders preserve wordmark identities.

## Acceptance

`src/features/names/literalNames.test.ts` requires one record per country unit,
bilingual non-empty text, valid enums, a pinned Factbook path or own sources,
https source URLs and the wordmark rules above. Changing a meaning, confidence
level or source needs a cited reason in `note` or `sources`; updating the
Factbook pin needs a review of every changed etymology entry.
