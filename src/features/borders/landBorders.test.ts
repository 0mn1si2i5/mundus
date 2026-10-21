import { describe, expect, it } from 'vitest';
import asset from '../../data/generated/land-borders.json';
import {
  createLandBorderGraph,
  findRoute,
  mostNeighbours,
  summarizeReach,
} from './landBorders';

const graph = createLandBorderGraph(asset);

const CHINA = 'ne-156';
const FRANCE = 'ne-250';
const BRAZIL = 'ne-076';
const UNITED_KINGDOM = 'ne-826';
const USA = 'ne-840';

function route(from: string, to: string) {
  const result = findRoute(graph, from, to);
  if (result.status !== 'route') throw new Error(result.status);
  return result;
}

describe('land border graph', () => {
  it('lists land neighbours by unit, including reviewed short borders', () => {
    expect(summarizeReach(graph, CHINA).neighbours).toHaveLength(16);
    expect(graph.neighbours.get('ne-446')).toEqual([CHINA]);
    expect(graph.neighbours.get('ne-072')).toContain('ne-894');
    expect(graph.neighbours.get(FRANCE)).toContain(BRAZIL);
    expect(graph.neighbours.get('ne-392')).toBeUndefined();
    expect(mostNeighbours(graph, 2)).toEqual([
      { countryId: CHINA, count: 16 },
      { countryId: 'ne-643', count: 14 },
    ]);
  });

  it('enters a unit through a detached part without crossing the sea', () => {
    const viaGuiana = route(BRAZIL, FRANCE);
    expect(viaGuiana.crossings).toBe(1);
    expect(viaGuiana.steps.at(-1)).toMatchObject({
      countryId: FRANCE,
      detached: true,
    });
    // French Guiana does not join South America to Europe.
    expect(findRoute(graph, USA, CHINA)).toEqual({ status: 'unreachable' });
    expect(route('ne-724', 'ne-504').steps[0]).toMatchObject({
      countryId: 'ne-724',
      detached: true,
    });
  });

  it('uses reviewed fixed links and counts only crossings between units', () => {
    const channel = route(UNITED_KINGDOM, FRANCE);
    expect(channel.crossings).toBe(1);
    expect(channel.steps[1]?.arrivedVia?.id).toBe('channel-tunnel');

    const denmark = route('ne-276', 'ne-752');
    expect(denmark.crossings).toBe(2);
    expect(denmark.steps.map((step) => step.countryId)).toEqual([
      'ne-276',
      'ne-208',
      'ne-752',
    ]);
    expect(denmark.steps[1]?.linksWithin.map((link) => link.id)).toEqual([
      'little-belt',
      'great-belt',
    ]);
    expect(denmark.steps[2]?.arrivedVia?.id).toBe('oresund');

    expect(route('ne-300', 'ne-364').crossings).toBe(2);
  });

  it('reports units with no land route and same-place requests', () => {
    expect(summarizeReach(graph, 'ne-392')).toMatchObject({
      neighbours: [],
      maxCrossings: 0,
      farthest: [],
    });
    expect(summarizeReach(graph, 'ne-702')).toMatchObject({ neighbours: [] });
    expect(summarizeReach(graph, 'ne-702').crossings.get('ne-458')).toBe(1);
    expect(findRoute(graph, null, FRANCE)).toEqual({ status: 'no-start' });
    expect(findRoute(graph, FRANCE, FRANCE)).toEqual({ status: 'same' });
  });

  it('measures the same number of crossings in both directions', () => {
    const ids = [...graph.partsByCountry.keys()];
    for (let i = 0; i < ids.length; i += 7) {
      const from = ids[i]!;
      const reach = summarizeReach(graph, from);
      for (const [to, crossings] of reach.crossings) {
        expect(summarizeReach(graph, to).crossings.get(from)).toBe(crossings);
      }
    }
  });

  it('rejects an asymmetric border list', () => {
    expect(() =>
      createLandBorderGraph({
        ...asset,
        parts: { 'ne-001/0': ['ne-002/0'], 'ne-002/0': [] },
      }),
    ).toThrow(/not symmetric/u);
  });
});
