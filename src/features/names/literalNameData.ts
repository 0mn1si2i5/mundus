import type { LiteralNameRecord } from './literalNameTypes';

export interface LiteralNameDataset {
  records: readonly LiteralNameRecord[];
  byId: ReadonlyMap<string, LiteralNameRecord>;
  factbook: { repository: string; commit: string };
}

/** Loads the reviewed table as its own chunk, only when the mode is entered. */
export async function loadLiteralNames(): Promise<LiteralNameDataset> {
  const { LITERAL_NAMES, LITERAL_NAMES_FACTBOOK } =
    await import('./literalNames');
  return {
    records: LITERAL_NAMES,
    byId: new Map(LITERAL_NAMES.map((record) => [record.id, record])),
    factbook: LITERAL_NAMES_FACTBOOK,
  };
}

/** Link to the pinned factbook.json entry a record reviews. */
export function factbookEntryUrl(
  dataset: LiteralNameDataset,
  path: string,
): string {
  return `${dataset.factbook.repository}/blob/${dataset.factbook.commit}/${path}.json`;
}
