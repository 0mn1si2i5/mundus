import { z } from 'zod';

/** A reviewed bridge or tunnel between two land parts. */
export interface FixedLink {
  id: string;
  name: { en: string; zh: string };
  opened: number;
}

export interface LandBorderGraph {
  /** Land border neighbours of each unit, excluding fixed links. */
  neighbours: ReadonlyMap<string, readonly string[]>;
  /** Units joined to another unit by a fixed link, with the link. */
  linkedUnits: ReadonlyMap<
    string,
    readonly { countryId: string; link: FixedLink }[]
  >;
  parts: readonly GraphPart[];
  partsByCountry: ReadonlyMap<string, readonly number[]>;
}

interface GraphPart {
  countryId: string;
  /** 0 is the unit's largest land part. */
  partNumber: number;
  edges: readonly { to: number; link: FixedLink | null }[];
}

export interface RouteStep {
  countryId: string;
  /** Every land part used lies apart from the unit's largest part. */
  detached: boolean;
  /** The link used to enter this unit from the previous step. */
  arrivedVia: FixedLink | null;
  /** Links used inside this unit, such as the Great Belt within Denmark. */
  linksWithin: readonly FixedLink[];
}

export type RouteResult =
  | { status: 'no-start' }
  | { status: 'same' }
  | { status: 'unreachable' }
  | { status: 'route'; crossings: number; steps: readonly RouteStep[] };

export interface ReachSummary {
  neighbours: readonly string[];
  linked: readonly { countryId: string; link: FixedLink }[];
  /** Crossings needed to reach each other unit; unreachable units are absent. */
  crossings: ReadonlyMap<string, number>;
  maxCrossings: number;
  farthest: readonly string[];
}

const partKey = z.string().regex(/^ne-(?:\d{3}|x-[a-z-]+)\/\d+$/);
const landBordersAssetSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  parts: z.record(partKey, z.array(partKey)),
  fixedLinks: z.array(
    z.object({
      id: z.string().min(1),
      name: z.object({ en: z.string().min(1), zh: z.string().min(1) }),
      opened: z.number().int(),
      a: partKey,
      b: partKey,
    }),
  ),
});

export type LandBordersAsset = z.infer<typeof landBordersAssetSchema>;

export async function loadLandBorderGraph(): Promise<LandBorderGraph> {
  const module = await import('../../data/generated/land-borders.json');
  return createLandBorderGraph(module.default);
}

export function createLandBorderGraph(input: unknown): LandBorderGraph {
  const asset = landBordersAssetSchema.parse(input);
  const keys = new Set(Object.keys(asset.parts));
  for (const link of asset.fixedLinks) {
    keys.add(link.a);
    keys.add(link.b);
  }
  const ordered = [...keys].sort(comparePartKeys);
  const indexOf = new Map(ordered.map((key, index) => [key, index]));
  const edges = ordered.map(
    () => [] as { to: number; link: FixedLink | null }[],
  );
  const neighbours = new Map<string, Set<string>>();
  const linkedUnits = new Map<
    string,
    { countryId: string; link: FixedLink }[]
  >();

  for (const [from, targets] of Object.entries(asset.parts)) {
    const fromIndex = indexOf.get(from)!;
    for (const to of targets) {
      const toIndex = indexOf.get(to);
      if (toIndex === undefined || !asset.parts[to]?.includes(from)) {
        throw new Error(`Land border ${from}–${to} is not symmetric`);
      }
      edges[fromIndex]!.push({ to: toIndex, link: null });
      const fromCountry = countryOf(from);
      const set = neighbours.get(fromCountry) ?? new Set();
      set.add(countryOf(to));
      neighbours.set(fromCountry, set);
    }
  }
  for (const { a, b, ...link } of asset.fixedLinks) {
    const first = indexOf.get(a)!;
    const second = indexOf.get(b)!;
    edges[first]!.push({ to: second, link });
    edges[second]!.push({ to: first, link });
    if (countryOf(a) !== countryOf(b)) {
      for (const [from, to] of [
        [a, b],
        [b, a],
      ] as const) {
        const list = linkedUnits.get(countryOf(from)) ?? [];
        list.push({ countryId: countryOf(to), link });
        linkedUnits.set(countryOf(from), list);
      }
    }
  }

  const parts = ordered.map((key, index) => ({
    countryId: countryOf(key),
    partNumber: Number(key.split('/')[1]),
    edges: edges[index]!,
  }));
  const partsByCountry = new Map<string, number[]>();
  parts.forEach((part, index) => {
    const list = partsByCountry.get(part.countryId) ?? [];
    list.push(index);
    partsByCountry.set(part.countryId, list);
  });

  return {
    neighbours: new Map(
      [...neighbours].map(([countryId, set]) => [countryId, [...set].sort()]),
    ),
    linkedUnits,
    parts,
    partsByCountry,
  };
}

interface Search {
  /** Crossings to reach each part, or Infinity. */
  distance: Float64Array;
  previous: Int32Array;
  previousLink: (FixedLink | null)[];
}

/**
 * Breadth-first search over land parts from every part of the start unit.
 * Moving between parts of different units is one crossing; a fixed link
 * inside one unit costs nothing.
 */
function search(graph: LandBorderGraph, startId: string): Search {
  const count = graph.parts.length;
  const distance = new Float64Array(count).fill(Infinity);
  const previous = new Int32Array(count).fill(-1);
  const previousLink: (FixedLink | null)[] = new Array(count).fill(null);
  const deque: number[] = [];
  for (const index of graph.partsByCountry.get(startId) ?? []) {
    distance[index] = 0;
    deque.push(index);
  }
  while (deque.length > 0) {
    const current = deque.shift()!;
    const part = graph.parts[current]!;
    for (const edge of part.edges) {
      const cost = graph.parts[edge.to]!.countryId === part.countryId ? 0 : 1;
      const next = distance[current]! + cost;
      if (next < distance[edge.to]!) {
        distance[edge.to] = next;
        previous[edge.to] = current;
        previousLink[edge.to] = edge.link;
        if (cost === 0) deque.unshift(edge.to);
        else deque.push(edge.to);
      }
    }
  }
  return { distance, previous, previousLink };
}

export function summarizeReach(
  graph: LandBorderGraph,
  startId: string,
): ReachSummary {
  const { distance } = search(graph, startId);
  const crossings = new Map<string, number>();
  graph.parts.forEach((part, index) => {
    const value = distance[index]!;
    if (part.countryId === startId || !Number.isFinite(value)) return;
    const current = crossings.get(part.countryId);
    if (current === undefined || value < current) {
      crossings.set(part.countryId, value);
    }
  });
  const maxCrossings = Math.max(0, ...crossings.values());
  return {
    neighbours: graph.neighbours.get(startId) ?? [],
    linked: graph.linkedUnits.get(startId) ?? [],
    crossings,
    maxCrossings,
    farthest: [...crossings]
      .filter(([, value]) => value === maxCrossings && maxCrossings > 0)
      .map(([countryId]) => countryId)
      .sort(),
  };
}

export function findRoute(
  graph: LandBorderGraph,
  startId: string | null,
  destinationId: string,
): RouteResult {
  if (!startId) return { status: 'no-start' };
  if (startId === destinationId) return { status: 'same' };
  const { distance, previous, previousLink } = search(graph, startId);
  let target = -1;
  for (const index of graph.partsByCountry.get(destinationId) ?? []) {
    if (target < 0 || distance[index]! < distance[target]!) target = index;
  }
  if (target < 0 || !Number.isFinite(distance[target]!)) {
    return { status: 'unreachable' };
  }

  const trail: { part: number; link: FixedLink | null }[] = [];
  for (let index = target; index >= 0; index = previous[index]!) {
    trail.unshift({ part: index, link: previousLink[index]! });
  }
  const steps: {
    countryId: string;
    partNumbers: number[];
    arrivedVia: FixedLink | null;
    linksWithin: FixedLink[];
  }[] = [];
  for (const { part, link } of trail) {
    const { countryId, partNumber } = graph.parts[part]!;
    const last = steps.at(-1);
    if (last?.countryId === countryId) {
      last.partNumbers.push(partNumber);
      if (link) last.linksWithin.push(link);
    } else {
      steps.push({
        countryId,
        partNumbers: [partNumber],
        arrivedVia: link,
        linksWithin: [],
      });
    }
  }
  return {
    status: 'route',
    crossings: distance[target]!,
    steps: steps.map(({ partNumbers, ...step }) => ({
      ...step,
      detached: !partNumbers.includes(0),
    })),
  };
}

/** Units with the most land border neighbours, most first. */
export function mostNeighbours(
  graph: LandBorderGraph,
  limit: number,
): readonly { countryId: string; count: number }[] {
  return [...graph.neighbours]
    .map(([countryId, list]) => ({ countryId, count: list.length }))
    .sort((a, b) => b.count - a.count || a.countryId.localeCompare(b.countryId))
    .slice(0, limit);
}

function countryOf(key: string): string {
  return key.slice(0, key.lastIndexOf('/'));
}

function comparePartKeys(a: string, b: string): number {
  const countryA = countryOf(a);
  const countryB = countryOf(b);
  if (countryA !== countryB) return countryA < countryB ? -1 : 1;
  return Number(a.split('/')[1]) - Number(b.split('/')[1]);
}
