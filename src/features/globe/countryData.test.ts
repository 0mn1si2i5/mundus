import { describe, expect, it } from 'vitest';
import { geoContains } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import surnameDataset from '../../data/generated/surnames-by-country.json';
import labelAnchors from '../../data/generated/country-label-anchors.json';
import atlas50 from 'world-atlas/countries-50m.json';
import {
  getBoundedTextureAnisotropy,
  getCountryDataset,
  getCountryHighlightTextureWidth,
  getCountryTextureStyle,
} from './countryData';
import {
  getCountryLabelAngularFootprintDegrees,
  getCountryLabelWorldWidth,
  getCountryLabelAnchor,
  getFallbackCountryLabelAnchor,
} from './countryLabel';

describe('country dataset', () => {
  const dataset = getCountryDataset();
  const detailedCountries = detailedCountryFeatures();
  const anchorsById = labelAnchors.anchors as Record<
    string,
    { point: { latitude: number; longitude: number }; clearanceDegrees: number }
  >;

  it('builds stable unique internal ids', () => {
    const ids = dataset.countries.features.map(
      (country) => country.properties.countryId,
    );
    expect(dataset.countries.features.length).toBeGreaterThan(170);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('ne-'))).toBe(true);
    expect(ids).toContain('ne-x-kosovo');
  });

  it('resolves representative land points and preserves ocean as null', () => {
    expect(
      dataset.findCountry({ latitude: 31.2304, longitude: 121.4737 })?.name,
    ).toBe('China');
    expect(
      dataset.findCountry({ latitude: 40.7128, longitude: -74.006 })?.name,
    ).toBe('United States of America');
    expect(dataset.findCountry({ latitude: 0, longitude: -140 })).toBeNull();
  });

  it('keeps surname label anchors inside their country geometry', () => {
    for (const [countryId, surnameCountry] of Object.entries(
      surnameDataset.countries,
    )) {
      const country = dataset.countries.features.find(
        (candidate) => candidate.properties.countryId === countryId,
      );
      if (!country) {
        const fallback = getFallbackCountryLabelAnchor(countryId);
        if (fallback) {
          expect(Number.isFinite(fallback.point.latitude), countryId).toBe(
            true,
          );
          expect(Number.isFinite(fallback.point.longitude), countryId).toBe(
            true,
          );
          expect(fallback.clearanceDegrees, countryId).toBeGreaterThan(0);
        } else {
          // Tuvalu is present in the surname asset but absent from both the
          // runtime 110m picking geometry and the reviewed 50m anchor asset.
          // Keep its side-panel record without inventing an ocean position.
          expect(countryId).toBe('ne-798');
        }
        continue;
      }
      const anchor = getCountryLabelAnchor(country!);
      const firstRecord = surnameCountry.records[0];
      if (!firstRecord) continue;
      expect(anchor, countryId).not.toBeNull();
      expect(
        geoContains(country!, [
          anchor!.point.longitude,
          anchor!.point.latitude,
        ]),
        countryId,
      ).toBe(true);
      expect(anchor!.clearanceDegrees, countryId).toBeGreaterThan(0);
      const width = getCountryLabelWorldWidth(anchor!.clearanceDegrees);
      const angularFootprint = getCountryLabelAngularFootprintDegrees(width);
      expect(angularFootprint, countryId).toBeLessThanOrEqual(
        anchor!.clearanceDegrees,
      );
      if (angularFootprint <= anchor!.clearanceDegrees) {
        for (let bearing = 0; bearing < 360; bearing += 22.5) {
          const edge = destinationPoint(
            anchor!.point,
            angularFootprint * 0.98,
            bearing,
          );
          expect(
            geoContains(country!, [edge.longitude, edge.latitude]),
            `${countryId} bearing ${bearing}`,
          ).toBe(true);
        }
      }
    }
  });

  it('keeps verified small-country label fallbacks finite', () => {
    for (const countryId of ['ne-234', 'ne-470']) {
      const anchor = getFallbackCountryLabelAnchor(countryId);
      expect(anchor, countryId).not.toBeNull();
      expect(Number.isFinite(anchor!.point.latitude)).toBe(true);
      expect(Number.isFinite(anchor!.point.longitude)).toBe(true);
      expect(anchor!.clearanceDegrees).toBeGreaterThan(0);
    }
  });

  it('keeps generated surname anchors and their footprints inside 50m geometry', () => {
    for (const countryId of Object.keys(surnameDataset.countries)) {
      const anchor = anchorsById[countryId];
      if (!anchor) continue;
      const matchingCountries = detailedCountries.filter(
        (country) => country.properties.countryId === countryId,
      );
      expect(matchingCountries.length, countryId).toBeGreaterThan(0);
      const contains = (point: { latitude: number; longitude: number }) =>
        matchingCountries.some((country) =>
          geoContains(country, [point.longitude, point.latitude]),
        );
      expect(contains(anchor.point), countryId).toBe(true);
      const width = getCountryLabelWorldWidth(anchor.clearanceDegrees);
      const angularFootprint = getCountryLabelAngularFootprintDegrees(width);
      if (
        angularFootprint <= anchor.clearanceDegrees &&
        anchor.clearanceDegrees > 0.2
      ) {
        for (let bearing = 0; bearing < 360; bearing += 22.5) {
          const edge = destinationPoint(
            anchor.point,
            angularFootprint * 0.98,
            bearing,
          );
          expect(contains(edge), `${countryId} bearing ${bearing}`).toBe(true);
        }
      }
    }
  });

  it('keeps the billboard footprint conservative as clearance shrinks', () => {
    expect(getCountryLabelWorldWidth(0)).toBe(0);
    expect(getCountryLabelWorldWidth(0.35)).toBeGreaterThan(0);
    expect(getCountryLabelWorldWidth(0.35)).toBeLessThan(
      getCountryLabelWorldWidth(5),
    );
    expect(getCountryLabelWorldWidth(35)).toBeLessThanOrEqual(0.34);
  });
});

function detailedCountryFeatures(): Feature<Geometry, { countryId: string }>[] {
  const topology = atlas50 as unknown as Topology<{
    countries: GeometryCollection<{ name: string }>;
  }>;
  const exceptions: Record<string, string> = {
    'N. Cyprus': 'ne-x-northern-cyprus',
    Somaliland: 'ne-x-somaliland',
    Kosovo: 'ne-x-kosovo',
    'Indian Ocean Ter.': 'ne-x-indian-ocean-territories',
    'Siachen Glacier': 'ne-x-siachen-glacier',
  };
  const countries = feature(
    topology,
    topology.objects.countries,
  ) as unknown as FeatureCollection<Geometry, { name: string }>;
  return countries.features.map((country) => ({
    ...country,
    properties: {
      countryId:
        country.id !== undefined
          ? `ne-${String(country.id).padStart(3, '0')}`
          : exceptions[country.properties.name]!,
    },
  }));
}

function destinationPoint(
  point: { latitude: number; longitude: number },
  distanceDegrees: number,
  bearingDegrees: number,
) {
  const latitude = (point.latitude * Math.PI) / 180;
  const longitude = (point.longitude * Math.PI) / 180;
  const distance = (distanceDegrees * Math.PI) / 180;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const nextLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(distance) +
      Math.cos(latitude) * Math.sin(distance) * Math.cos(bearing),
  );
  const nextLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearing) * Math.sin(distance) * Math.cos(latitude),
      Math.cos(distance) - Math.sin(latitude) * Math.sin(nextLatitude),
    );
  return {
    latitude: (nextLatitude * 180) / Math.PI,
    longitude:
      (((((nextLongitude * 180) / Math.PI + 540) % 360) + 360) % 360) - 180,
  };
}

describe('country texture rendering', () => {
  it('keeps every profile border at least one source pixel wide', () => {
    expect(getCountryTextureStyle(1024).borderWidth).toBeGreaterThanOrEqual(1);
    expect(getCountryTextureStyle(2048).borderWidth).toBeGreaterThanOrEqual(1);
  });

  it('uses a bright parchment atlas palette with dark ink borders', () => {
    expect(getCountryTextureStyle(2048)).toMatchObject({
      oceanColor: '#c7d2cd',
      landColor: '#ddd2b5',
      borderColor: 'rgba(67, 66, 58, 0.82)',
    });
  });

  it('bounds texture anisotropy by renderer capability and exhibit budget', () => {
    expect(getBoundedTextureAnisotropy(1)).toBe(1);
    expect(getBoundedTextureAnisotropy(4)).toBe(4);
    expect(getBoundedTextureAnisotropy(16)).toBe(8);
  });

  it('bounds the reusable highlight overlay below detailed base textures', () => {
    expect(getCountryHighlightTextureWidth(1024)).toBe(1024);
    expect(getCountryHighlightTextureWidth(2048)).toBe(1024);
  });
});
