import { describe, expect, it } from 'vitest';
import type { CountryFeature } from './countryData';
import {
  chooseAlternativeSurnameLabelSlot,
  chooseSurnameLabelSlot,
  createSurnameLabelSlotCandidates,
  isSurnameLabelSlotAllowed,
  isSurnameLabelSlotOnRenderedLand,
  maximizeSurnameLabelSlot,
  sampleSurnameLabelEnvelope,
} from './surnameLabelSlots';
import generatedSlots from '../../data/generated/surname-label-slots.json';
import { getCountryDataset } from './countryData';

const country = (
  countryId: string,
  coordinates: number[][][],
): CountryFeature => ({
  type: 'Feature',
  properties: { countryId, name: countryId },
  geometry: { type: 'Polygon', coordinates },
});

describe('surname label slots', () => {
  it('offers deterministic east-west candidates for both legacy layout keys', () => {
    const straight = createSurnameLabelSlotCandidates(
      { latitude: 0, longitude: 0 },
      2,
      'straight',
    );
    const arched = createSurnameLabelSlotCandidates(
      { latitude: 0, longitude: 0 },
      2,
      'arched',
    );
    expect(straight).toHaveLength(5);
    expect(straight.every((slot) => slot.rotationDegrees === 0)).toBe(true);
    expect(arched.every((slot) => slot.curvature > 0)).toBe(true);
  });

  it('allows ocean overflow while rejecting sampled neighboring land', () => {
    const slots = createSurnameLabelSlotCandidates(
      { latitude: 0, longitude: 0 },
      2,
      'straight',
    );
    const south = slots.find((slot) => slot.oceanDirection === 'south')!;
    const neighboringLand = country('neighbor', [
      [
        [-1, -1],
        [-1, 1],
        [1, 1],
        [1, -1],
        [-1, -1],
      ],
    ]);
    expect(isSurnameLabelSlotAllowed(south, 'own', [], 1)).toBe(true);
    expect(isSurnameLabelSlotAllowed(south, 'own', [neighboringLand], 1)).toBe(
      false,
    );
    expect(sampleSurnameLabelEnvelope(south).length).toBe(25);
  });

  it('samples zero-rotation safety envelopes along exact parallels', () => {
    const slot = createSurnameLabelSlotCandidates(
      { latitude: 38, longitude: 12 },
      8,
      'straight',
    ).find((candidate) => candidate.oceanDirection === 'none')!;
    const samples = sampleSurnameLabelEnvelope(slot, 8);
    for (let across = 0; across < 5; across += 1) {
      const latitude = samples[across]!.latitude;
      for (let along = 1; along < 5; along += 1) {
        expect(samples[along * 5 + across]!.latitude).toBeCloseTo(latitude, 10);
      }
    }
  });

  it('keeps the wordmark center on the selected country', () => {
    const slots = createSurnameLabelSlotCandidates(
      { latitude: 0, longitude: 0 },
      2,
      'straight',
    );
    const own = country('own', [
      [
        [-1, -1],
        [-1, 1],
        [1, 1],
        [1, -1],
        [-1, -1],
      ],
    ]);
    const offshore = {
      ...slots.find((slot) => slot.oceanDirection === 'south')!,
      center: { latitude: -5, longitude: 0 },
    };
    expect(isSurnameLabelSlotAllowed(offshore, 'own', [own], 0.5)).toBe(false);
    const interior = slots.find((slot) => slot.oceanDirection === 'none')!;
    expect(isSurnameLabelSlotAllowed(interior, 'own', [own], 0.5)).toBe(true);
  });

  it('rejects ordinary coastal overflow when the own country is known', () => {
    const own = country('own', [
      [
        [-1, -1],
        [-1, 1],
        [1, 1],
        [1, -1],
        [-1, -1],
      ],
    ]);
    const slot = {
      ...createSurnameLabelSlotCandidates(
        { latitude: 0, longitude: 0 },
        2,
        'straight',
      )[0]!,
      maxAngularDegrees: 2,
      countryScaleCap: 2,
      isolatedOverflow: false,
    };
    expect(isSurnameLabelSlotAllowed(slot, 'own', [own], 2)).toBe(false);
  });

  it('keeps generated 50m safety flags explicit for every candidate', () => {
    expect(
      generatedSlots.candidatePolicy.evaluatedCentersPerCountry,
    ).toBeGreaterThanOrEqual(3);
    const candidates = Object.values(generatedSlots.slots).flat();
    expect(candidates.length).toBeGreaterThanOrEqual(240);
    const narrowRotations = new Set<number>(
      generatedSlots.candidatePolicy.narrowRotations,
    );
    expect(
      candidates.every(
        (slot) =>
          slot.layout === 'straight' &&
          (slot.rotationDegrees === 0 ||
            narrowRotations.has(slot.rotationDegrees)),
      ),
    ).toBe(true);
    // Horizontal stays the default; rotation is a narrow-country exception.
    const rotated = candidates.filter((slot) => slot.rotationDegrees !== 0);
    expect(rotated.length).toBeGreaterThan(0);
    expect(rotated.length).toBeLessThan(candidates.length / 4);
    expect(candidates.every((slot) => typeof slot.landSafe === 'boolean')).toBe(
      true,
    );
    expect(candidates.some((slot) => slot.landSafe === false)).toBe(true);
    expect(
      candidates.some(
        (slot) => slot.landSafe && typeof slot.squareMax === 'number',
      ),
    ).toBe(true);
    expect(
      candidates.some(
        (slot) =>
          slot.landSafe &&
          'foreignClearance' in slot &&
          'squareForeignClearance' in slot &&
          slot.foreignClearance !== slot.squareForeignClearance,
      ),
    ).toBe(true);
  });

  it('keeps the generated candidate metadata within its declared geometry caps', () => {
    const candidates = Object.values(generatedSlots.slots).flat();
    // A zero-width candidate is an explicit no-safe-envelope sentinel for a
    // rare disputed or sliver geometry; runtime filtering hides it.
    expect(candidates.every((slot) => slot.maxAngularDegrees >= 0)).toBe(true);
    expect(
      candidates.every(
        (slot) =>
          (slot.strictMaxAngularDegrees ?? slot.maxAngularDegrees) <=
          (slot.countryScaleCap ?? 20) + 1e-9,
      ),
    ).toBe(true);
    expect(
      candidates.every(
        (slot) =>
          (slot.neighborSafe ?? slot.maxAngularDegrees) <=
          slot.maxAngularDegrees + 1e-9,
      ),
    ).toBe(true);
    const brazil = generatedSlots.slots['ne-076']!;
    expect(
      new Set(
        brazil.map(
          (slot) => `${slot.center.latitude}:${slot.center.longitude}`,
        ),
      ).size,
    ).toBeGreaterThan(1);
    const marshallIslands = generatedSlots.slots['ne-584']!;
    expect(
      Math.max(...marshallIslands.map((slot) => slot.maxAngularDegrees)),
    ).toBeLessThanOrEqual(
      Math.max(...marshallIslands.map((slot) => slot.countryScaleCap ?? 20)) +
        1e-9,
    );
  });

  it('does not let coarse local clearance cap a large country below its area ceiling', () => {
    const wordmark = {
      value: 'Silva',
      source: 'latin' as const,
      requestedMode: 'latin' as const,
      fellBack: false,
      generated: false,
      layout: 'straight' as const,
      characterCount: 5,
    };
    const expanded = maximizeSurnameLabelSlot(
      {
        layout: 'straight',
        center: { latitude: 0, longitude: 0 },
        rotationDegrees: 0,
        curvature: 0,
        maxAngularDegrees: 9.025,
        countryScaleCap: 20,
        localClearance: 9,
        oceanDirection: 'none',
        landSafe: true,
      },
      'own',
      [],
      wordmark,
    );
    expect(expanded?.maxAngularDegrees).toBe(20);
  });

  it('keeps only parallel generated straight directions', () => {
    const brazilDirections = new Set(
      generatedSlots.slots['ne-076']!.filter(
        (slot) => slot.layout === 'straight',
      ).map((slot) => slot.rotationDegrees),
    );
    expect(brazilDirections).toEqual(new Set([0]));
  });

  it('keeps a layout candidate for every generated country after safety fallback', () => {
    const wordmark = {
      value: 'Atlas',
      source: 'latin' as const,
      requestedMode: 'latin' as const,
      fellBack: false,
      generated: false,
      layout: 'straight' as const,
      characterCount: 5,
    };
    const countryIds = Object.keys(generatedSlots.slots) as Array<
      keyof typeof generatedSlots.slots
    >;
    expect(countryIds).toHaveLength(239);
    for (const countryId of countryIds) {
      const first = generatedSlots.slots[countryId]![0]!;
      expect(
        chooseSurnameLabelSlot(
          countryId,
          { point: first.center, clearanceDegrees: first.maxAngularDegrees },
          wordmark,
          [],
        ),
      ).not.toBeNull();
    }
  });

  it('expands a safe wordmark to the largest sampled envelope', () => {
    const [slot] = createSurnameLabelSlotCandidates(
      { latitude: 0, longitude: 0 },
      2,
      'straight',
    );
    const wordmark = {
      value: 'Atlas',
      source: 'latin' as const,
      requestedMode: 'latin' as const,
      fellBack: false,
      generated: false,
      layout: 'straight' as const,
      characterCount: 5,
    };
    const expanded = maximizeSurnameLabelSlot(slot!, 'own', [], wordmark)!;
    expect(expanded.maxAngularDegrees).toBe(
      Math.min(20, slot!.countryScaleCap ?? 20),
    );

    const neighboringLand = country('neighbor', [
      [
        [-20, -20],
        [-20, 20],
        [20, 20],
        [20, -20],
        [-20, -20],
      ],
    ]);
    expect(
      maximizeSurnameLabelSlot(slot!, 'own', [neighboringLand], wordmark),
    ).toBeNull();
  });

  it('switches a blocked selected wordmark to a different safe candidate', () => {
    const wordmark = {
      value: 'Wang',
      source: 'latin' as const,
      requestedMode: 'latin' as const,
      fellBack: false,
      generated: false,
      layout: 'straight' as const,
      characterCount: 4,
    };
    const current = chooseSurnameLabelSlot(
      'ne-156',
      {
        point: { latitude: 31.34112, longitude: 109.462995 },
        clearanceDegrees: 9.75,
      },
      wordmark,
      [],
    );
    expect(current).not.toBeNull();
    const alternate = chooseAlternativeSurnameLabelSlot(
      'ne-156',
      {
        point: { latitude: 31.34112, longitude: 109.462995 },
        clearanceDegrees: 9.75,
      },
      wordmark,
      [],
      current!,
    );
    expect(alternate).not.toBeNull();
    expect(
      `${alternate!.center.latitude.toFixed(5)}:${alternate!.center.longitude.toFixed(5)}`,
    ).not.toBe(
      `${current!.center.latitude.toFixed(5)}:${current!.center.longitude.toFixed(5)}`,
    );
  });
});

describe('rotated wordmarks for elongated countries', () => {
  const latin = (value: string) => ({
    value,
    source: 'latin' as const,
    requestedMode: 'latin' as const,
    fellBack: false,
    generated: false,
    layout: 'straight' as const,
    characterCount: Array.from(value).length,
  });
  const italy = {
    point: { latitude: 42.8, longitude: 12.6 },
    clearanceDegrees: 1,
  };

  it('keeps compact countries on a horizontal parallel', () => {
    const generated = generatedSlots.slots as Record<
      string,
      { rotationDegrees: number }[]
    >;
    for (const countryId of ['ne-250', 'ne-076', 'ne-012']) {
      expect(
        generated[countryId]!.every((slot) => slot.rotationDegrees === 0),
      ).toBe(true);
    }
  });

  it('turns a long wordmark along a narrow country', () => {
    const horizontal = chooseSurnameLabelSlot(
      'ne-380',
      italy,
      latin('Rossi'),
      [],
    );
    const long = chooseSurnameLabelSlot('ne-380', italy, latin('Esposito'), []);
    // A medium word already fits the Po valley on its parallel; only a long
    // word gains enough from following the peninsula to be rotated.
    expect(horizontal!.rotationDegrees).toBe(0);
    expect(horizontal!.maxAngularDegrees).toBeGreaterThan(1.5);
    expect(Math.abs(long!.rotationDegrees)).toBeGreaterThan(0);
    expect(long!.maxAngularDegrees).toBeGreaterThan(2);
  });

  it('never tilts a compact square wordmark', () => {
    const slot = chooseSurnameLabelSlot('ne-380', italy, latin('Li'), []);
    expect(slot).not.toBeNull();
    expect(slot!.rotationDegrees).toBe(0);
  });
});

describe('surname label slots on the rendered globe', () => {
  const slotsByCountry = (
    generatedSlots as unknown as {
      slots: Record<
        string,
        Parameters<typeof isSurnameLabelSlotOnRenderedLand>[0][]
      >;
    }
  ).slots;
  const lowDetail = new Map(
    getCountryDataset().countries.features.map((feature) => [
      feature.properties.countryId,
      feature,
    ]),
  );

  it('keeps every 50m slot because slots are generated against 50m land', () => {
    const [maltaSlot] = slotsByCountry['ne-470']!;
    expect(
      isSurnameLabelSlotOnRenderedLand(maltaSlot!, 'ne-470', '50m', lowDetail),
    ).toBe(true);
  });

  it('drops a 110m wordmark whose country has no rendered land', () => {
    const [maltaSlot] = slotsByCountry['ne-470']!;
    expect(lowDetail.has('ne-470')).toBe(false);
    expect(
      isSurnameLabelSlotOnRenderedLand(maltaSlot!, 'ne-470', '110m', lowDetail),
    ).toBe(false);
  });

  it('keeps a 110m wordmark that sits on its own rendered country', () => {
    const [italySlot] = slotsByCountry['ne-380']!;
    expect(
      isSurnameLabelSlotOnRenderedLand(italySlot!, 'ne-380', '110m', lowDetail),
    ).toBe(true);
  });

  it('drops a 110m wordmark that lies on land another country owns', () => {
    const [italySlot] = slotsByCountry['ne-380']!;
    expect(
      isSurnameLabelSlotOnRenderedLand(italySlot!, 'ne-250', '110m', lowDetail),
    ).toBe(false);
  });

  it('keeps a single-character wordmark near the country centre', () => {
    const wordmark = {
      value: '王',
      source: 'chinese' as const,
      requestedMode: 'chinese' as const,
      fellBack: false,
      generated: false,
      layout: 'straight' as const,
      characterCount: 1,
    };
    const slot = chooseSurnameLabelSlot(
      'ne-156',
      {
        point: { latitude: 31.34112, longitude: 109.462995 },
        clearanceDegrees: 9.75,
      },
      wordmark,
      [],
    );
    expect(slot).not.toBeNull();
    // East-central China rather than the Tibetan plateau, and no smaller
    // than the square slot that plateau offered (9.26°).
    expect(slot!.center.longitude).toBeGreaterThan(104);
    expect(slot!.maxAngularDegrees).toBeGreaterThan(9.26);
  });
});
