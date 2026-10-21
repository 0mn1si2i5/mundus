export interface LiteralText {
  zh: string;
  en: string;
}

/**
 * How firmly the literal meaning is established. `disputed` records show the
 * most common reading on the globe with a question mark; `unknown` records
 * show no wordmark and explain why in the result card.
 */
export type LiteralNameConfidence =
  'established' | 'likely' | 'disputed' | 'unknown';

/**
 * How the reviewed Chinese country name relates to the name it renders.
 * Generic terms such as 群岛, 岛 or 共和国 do not change the kind.
 */
export type ChineseNameKind =
  /** Sound only: 阿根廷 ← Argentina. */
  | 'phonetic'
  /** Meaning only: 冰岛 ← Iceland, 黑山 ← Montenegro. */
  | 'semantic'
  /** Part sound, part meaning: 新西兰, 佛得角, 南苏丹. */
  | 'mixed'
  /** The country's own name in Chinese characters: 中国, 日本, 越南. */
  | 'native'
  /** First syllable of a longer transliteration plus 国: 美国, 法国. */
  | 'abbreviated';

export interface LiteralNameSource {
  title: string;
  url: string;
  /**
   * `search-summary` marks a page that the build container could only read
   * through search excerpts; it should be opened and confirmed by a reviewer.
   */
  checked?: 'search-summary';
}

export interface LiteralNameRecord {
  /** Mundus country unit id (`mundus-countries`). */
  id: string;
  /**
   * factbook.json path (`region/gec`) of the World Factbook entry whose
   * etymology this record reviews, or `null` when the Factbook has none.
   */
  factbook: string | null;
  /** The name as written locally, in its own script. */
  local: string;
  /** BCP 47 tag for `local`. */
  lang: string;
  confidence: LiteralNameConfidence;
  /**
   * Which name `literal` translates. Most records read the international
   * name; `local` is used where only the local name has a clear meaning.
   */
  basis?: 'local';
  /** Short wordmark text drawn on the globe. */
  literal: LiteralText;
  /** The words the name comes from. */
  from: LiteralText;
  /** An optional sentence of context, competing readings or a correction. */
  note?: LiteralText;
  zhKind: ChineseNameKind;
  /** Optional note on where the Chinese name comes from. */
  zhNote?: LiteralText;
  /** Sources beyond the Factbook entry, required when the record departs from it. */
  sources?: readonly LiteralNameSource[];
}
