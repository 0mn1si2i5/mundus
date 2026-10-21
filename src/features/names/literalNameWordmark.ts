import type { Locale } from '../../i18n/messages';
import type { SurnameWordmark } from '../surnames/surnameWordmark';
import type { LiteralNameRecord } from './literalNameTypes';

/** What every Literal Names wordmark on the globe shows. */
export type LiteralNameLabel = 'literal' | 'local';
export const DEFAULT_LITERAL_NAME_LABEL: LiteralNameLabel = 'literal';

/** The first of several local forms, such as "België / Belgique". */
export function primaryLocalName(record: LiteralNameRecord): string {
  return record.local.split(' / ')[0]!.trim();
}

/**
 * Chooses the wordmark text for one country. A record whose meaning is
 * unknown has no literal wordmark; a disputed one is marked with a question
 * mark so the globe never states it as settled.
 */
export function resolveLiteralNameWordmark(
  record: LiteralNameRecord,
  label: LiteralNameLabel,
  locale: Locale,
): SurnameWordmark | null {
  let value: string;
  let source: SurnameWordmark['source'];
  if (label === 'local') {
    value = primaryLocalName(record);
    source = 'local';
  } else {
    if (record.confidence === 'unknown') return null;
    const mark =
      record.confidence === 'disputed' ? (locale === 'zh' ? '？' : '?') : '';
    value = `${record.literal[locale]}${mark}`;
    source = locale === 'zh' ? 'chinese' : 'latin';
  }
  return {
    value,
    source,
    requestedMode: source,
    fellBack: false,
    generated: false,
    layout: 'straight',
    characterCount: Array.from(value).length,
  };
}
