import { geoArea, geoCentroid, geoContains } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import {
  DataTexture,
  NearestFilter,
  RGBAFormat,
  ShapeUtils,
  UnsignedByteType,
  Vector2,
} from 'three';

const DEG = Math.PI / 180;
// Palette indices 900–904 are reserved for units without an ISO numeric code.
const EXCEPTION_COUNTRY_INDICES = {
  'ne-x-bir-tawil': 900,
};

/**
 * Mundus topologies carry `countryId`; plain GeoJSON inputs (test fixtures)
 * fall back to a numeric feature id.
 */
export function countryIdFor(properties, sourceId) {
  if (properties?.countryId) return properties.countryId;
  if (/^\d{1,3}$/.test(String(sourceId ?? '')))
    return `ne-${String(sourceId).padStart(3, '0')}`;
  throw new Error(`Missing countryId for ${String(properties?.name)}`);
}

export function topologyToCountries(topology) {
  const collection = feature(topology, topology.objects.countries);
  const features = collection.features
    .map((country) => ({
      ...country,
      properties: {
        ...country.properties,
        countryId: countryIdFor(country.properties, country.id),
      },
    }))
    .sort((a, b) =>
      a.properties.countryId.localeCompare(b.properties.countryId),
    );
  const result = { type: 'FeatureCollection', features };
  Object.defineProperty(result, 'sourceTopology', { value: topology });
  return result;
}

export function buildVectorGlobe(input, options = {}) {
  const maxEdgeDegrees = options.maxEdgeDegrees ?? 2;
  const countries =
    input.type === 'Topology'
      ? topologyToCountries(input)
      : normalizeCountries(input);
  const topology = input.type === 'Topology' ? input : countries.sourceTopology;
  const positions = [];
  const countryIndices = [];
  const indices = [];
  let degenerateTriangles = 0;
  let outsideTriangles = 0;
  let candidateAreaSteradians = 0;
  let acceptedAreaSteradians = 0;
  let droppedOutsideAreaSteradians = 0;
  const areaByCountry = new Map();
  const partArea = [];
  let maxTriangleEdgeDegrees = 0;

  const countryRecords = uniqueCountryRecords(countries.features);
  const countryIndexById = new Map(
    countryRecords.map((country) => [country.countryId, country.countryIndex]),
  );
  countries.features.forEach((country) => {
    const countryIndex = countryIndexById.get(country.properties.countryId);
    for (const [partIndex, polygon] of polygonsOf(country.geometry).entries()) {
      const partSourceAreaSteradians = geoArea({
        type: 'Polygon',
        coordinates: polygon,
      });
      let partAcceptedAreaSteradians = 0;
      const { triangles, contains } = triangulatePolygon(polygon);
      const vertexMap = new Map();
      for (const triangle of triangles) {
        const subdivided = subdivideTriangle(triangle, maxEdgeDegrees);
        const containmentRefined = subdivided.flatMap((points) =>
          refineTriangleContainment(
            points,
            (point) => contains(point) && geoContains(country, point),
            country.properties.countryId,
          ),
        );
        for (const { points, accepted } of containmentRefined) {
          const area = sphericalTriangleArea(points);
          if (area < 1e-12) {
            degenerateTriangles += 1;
            continue;
          }
          candidateAreaSteradians += area;
          const countryArea = areaByCountry.get(
            country.properties.countryId,
          ) ?? {
            candidateAreaSteradians: 0,
            droppedOutsideAreaSteradians: 0,
          };
          countryArea.candidateAreaSteradians += area;
          areaByCountry.set(country.properties.countryId, countryArea);
          if (!accepted) {
            outsideTriangles += 1;
            droppedOutsideAreaSteradians += area;
            countryArea.droppedOutsideAreaSteradians += area;
            continue;
          }
          acceptedAreaSteradians += area;
          partAcceptedAreaSteradians += area;
          const triangleIndices = points.map((point) => {
            const xyz = lonLatToXyz(point);
            const key = xyz.map((value) => value.toFixed(9)).join(',');
            let index = vertexMap.get(key);
            if (index === undefined) {
              index = positions.length / 3;
              vertexMap.set(key, index);
              positions.push(...xyz);
              countryIndices.push(countryIndex);
            }
            return index;
          });
          indices.push(...triangleIndices);
          maxTriangleEdgeDegrees = Math.max(
            maxTriangleEdgeDegrees,
            ...triangleEdges(points).map(angularDistanceDegrees),
          );
        }
      }
      partArea.push({
        countryId: country.properties.countryId,
        partIndex,
        sourceAreaSteradians: partSourceAreaSteradians,
        acceptedAreaSteradians: partAcceptedAreaSteradians,
        deficitFraction:
          partSourceAreaSteradians === 0
            ? 0
            : Math.abs(partSourceAreaSteradians - partAcceptedAreaSteradians) /
              partSourceAreaSteradians,
      });
    }
  });

  const coastline = topology
    ? lineGeometry(mesh(topology, topology.objects.land), maxEdgeDegrees, 1.001)
    : lineGeometry(boundaryCollection(countries), maxEdgeDegrees, 1.001);
  const borders = topology
    ? lineGeometry(
        mesh(topology, topology.objects.countries, (a, b) => a !== b),
        maxEdgeDegrees,
        1.002,
      )
    : { positions: new Float32Array(), indices: new Uint32Array() };

  return {
    countries: countryRecords,
    surface: {
      positions: new Float32Array(positions),
      countryIndices: new Uint16Array(countryIndices),
      indices: typedIndices(indices, positions.length / 3),
    },
    coastline,
    borders,
    metrics: {
      degenerateTriangles,
      outsideTriangles,
      maxTriangleEdgeDegrees,
      candidateAreaSteradians,
      acceptedAreaSteradians,
      droppedOutsideAreaSteradians,
      droppedOutsideAreaFraction:
        candidateAreaSteradians === 0
          ? 0
          : droppedOutsideAreaSteradians / candidateAreaSteradians,
      countryArea: Object.fromEntries(
        [...areaByCountry].map(([countryId, area]) => [
          countryId,
          {
            ...area,
            droppedOutsideAreaFraction:
              area.candidateAreaSteradians === 0
                ? 0
                : area.droppedOutsideAreaSteradians /
                  area.candidateAreaSteradians,
          },
        ]),
      ),
      containmentSamplesPerTriangle: 4,
      partArea,
    },
    containsCountry(longitude, latitude) {
      const match = countries.features.find((country) =>
        geoContains(country, [longitude, latitude]),
      );
      return match
        ? { countryId: match.properties.countryId, name: match.properties.name }
        : null;
    },
  };
}

function uniqueCountryRecords(features) {
  const records = new Map();
  for (const { properties } of features) {
    if (!records.has(properties.countryId)) {
      records.set(properties.countryId, {
        countryId: properties.countryId,
        name: properties.name,
        countryIndex: stableCountryIndex(properties.countryId),
      });
    }
  }
  return [...records.values()];
}

function stableCountryIndex(countryId) {
  if (/^ne-\d{3}$/.test(countryId)) return Number(countryId.slice(3));
  const index = EXCEPTION_COUNTRY_INDICES[countryId];
  if (index === undefined)
    throw new Error(`Missing stable country index for ${countryId}`);
  return index;
}

function normalizeCountries(collection) {
  return {
    ...collection,
    features: collection.features
      .map((country) => ({
        ...country,
        properties: {
          ...country.properties,
          countryId: countryIdFor(country.properties, country.id),
        },
      }))
      .sort((a, b) =>
        a.properties.countryId.localeCompare(b.properties.countryId),
      ),
  };
}

function polygonsOf(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function triangulatePolygon(rings) {
  const polygonFeature = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: rings },
  };
  const center = geoCentroid(polygonFeature);
  const projectedRings = rings
    .map((ring) =>
      stripClosingPoint(ring).map((point) => ({
        point,
        projected: projectGnomonic(point, center),
      })),
    )
    .filter((ring) => ring.length >= 3);
  const outer = projectedRings.toSorted(
    (a, b) => Math.abs(projectedRingArea(b)) - Math.abs(projectedRingArea(a)),
  )[0];
  if (!outer) return { triangles: [], contains: () => false };
  if (projectedRingArea(outer) > 0) outer.reverse();
  const outerPoints = outer.map((item) => item.projected);
  const holes = projectedRings
    .filter(
      (ring) =>
        ring !== outer && pointInRing(projectedRingCentroid(ring), outerPoints),
    )
    .map((ring) => {
      if (projectedRingArea(ring) < 0) ring.reverse();
      return ring;
    });
  const orderedRings = [outer, ...holes];
  const contour = outer.map(({ projected }) => new Vector2(...projected));
  const holeVectors = holes.map((ring) =>
    ring.map(({ projected }) => new Vector2(...projected)),
  );
  const sourcePoints = orderedRings.flat().map(({ point }) => point);
  return {
    triangles: ShapeUtils.triangulateShape(contour, holeVectors).map(
      (triangle) => triangle.map((index) => sourcePoints[index]),
    ),
    contains(point) {
      const projected = projectGnomonic(point, center);
      return (
        pointInRing(projected, outerPoints) &&
        !holes.some((ring) =>
          pointInRing(
            projected,
            ring.map((item) => item.projected),
          ),
        )
      );
    },
  };
}

function projectedRingArea(ring) {
  let area = 0;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index++
  ) {
    const [x, y] = ring[index].projected;
    const [previousX, previousY] = ring[previous].projected;
    area += previousX * y - x * previousY;
  }
  return area / 2;
}

function projectedRingCentroid(ring) {
  const center = ring.reduce(
    (sum, item) => [sum[0] + item.projected[0], sum[1] + item.projected[1]],
    [0, 0],
  );
  return [center[0] / ring.length, center[1] / ring.length];
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index++
  ) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function stripClosingPoint(ring) {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1]
    ? ring.slice(0, -1)
    : ring;
}

function projectGnomonic(
  [longitude, latitude],
  [centerLongitude, centerLatitude],
) {
  const lambda = normalizeRadians((longitude - centerLongitude) * DEG);
  const phi = latitude * DEG;
  const phi0 = centerLatitude * DEG;
  const cosine =
    Math.sin(phi0) * Math.sin(phi) +
    Math.cos(phi0) * Math.cos(phi) * Math.cos(lambda);
  if (cosine <= 1e-8)
    return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const scale = 1 / cosine;
  return [
    scale * Math.cos(phi) * Math.sin(lambda),
    scale *
      (Math.cos(phi0) * Math.sin(phi) -
        Math.sin(phi0) * Math.cos(phi) * Math.cos(lambda)),
  ];
}

function normalizeRadians(value) {
  return (
    ((((value + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) -
    Math.PI
  );
}

function subdivideTriangle(triangle, maxEdgeDegrees) {
  const longest = triangleEdges(triangle)
    .map((edge, index) => ({ index, degrees: angularDistanceDegrees(edge) }))
    .sort((a, b) => b.degrees - a.degrees)[0];
  if (longest.degrees <= maxEdgeDegrees) return [triangle];
  const [aIndex, bIndex] = [
    [0, 1],
    [1, 2],
    [2, 0],
  ][longest.index];
  const otherIndex = [0, 1, 2].find(
    (index) => index !== aIndex && index !== bIndex,
  );
  const midpoint = sphericalMidpoint(triangle[aIndex], triangle[bIndex]);
  return [
    ...subdivideTriangle(
      [triangle[aIndex], midpoint, triangle[otherIndex]],
      maxEdgeDegrees,
    ),
    ...subdivideTriangle(
      [midpoint, triangle[bIndex], triangle[otherIndex]],
      maxEdgeDegrees,
    ),
  ];
}

function triangleEdges([a, b, c]) {
  return [
    [a, b],
    [b, c],
    [c, a],
  ];
}

function angularDistanceDegrees([a, b]) {
  const av = lonLatToXyz(a);
  const bv = lonLatToXyz(b);
  const dot = Math.max(
    -1,
    Math.min(1, av[0] * bv[0] + av[1] * bv[1] + av[2] * bv[2]),
  );
  return Math.acos(dot) / DEG;
}

function sphericalMidpoint(a, b) {
  const av = lonLatToXyz(a);
  const bv = lonLatToXyz(b);
  const x = av[0] + bv[0];
  const y = av[1] + bv[1];
  const z = av[2] + bv[2];
  const length = Math.hypot(x, y, z);
  return [Math.atan2(y, x) / DEG, Math.asin(z / length) / DEG];
}

function lonLatToXyz([longitude, latitude], radius = 1) {
  const lambda = longitude * DEG;
  const phi = latitude * DEG;
  const cosine = Math.cos(phi);
  return [
    radius * cosine * Math.cos(lambda),
    radius * cosine * Math.sin(lambda),
    radius * Math.sin(phi),
  ];
}

function sphericalTriangleArea(points) {
  const [a, b, c] = points.map((point) => lonLatToXyz(point));
  const determinant =
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0]);
  const denominator =
    1 +
    a[0] * b[0] +
    a[1] * b[1] +
    a[2] * b[2] +
    b[0] * c[0] +
    b[1] * c[1] +
    b[2] * c[2] +
    c[0] * a[0] +
    c[1] * a[1] +
    c[2] * a[2];
  return Math.abs(2 * Math.atan2(determinant, denominator));
}

function refineTriangleContainment(points, contains, countryId, depth = 0) {
  // Sample exactly what the runtime interpolates: the decoded signed
  // normalized 16-bit vertex vectors, weighted without renormalization.
  const runtimeVectors = points.map(transportRoundTripVector);
  const centroid = weightedVectorPoint(runtimeVectors, [1 / 3, 1 / 3, 1 / 3]);
  if (countryId === 'ne-010' && centroid[1] < -89.9) {
    return [{ points, accepted: true }];
  }
  // A triangle whose vertices collapse to the same transported position is
  // invisible at runtime and cannot be sampled meaningfully.
  const keys = runtimeVectors.map((vector) => vector.join(','));
  if (new Set(keys).size < 3) return [{ points, accepted: false }];
  const samples = [
    centroid,
    weightedVectorPoint(runtimeVectors, [0.6, 0.2, 0.2]),
    weightedVectorPoint(runtimeVectors, [0.2, 0.6, 0.2]),
    weightedVectorPoint(runtimeVectors, [0.2, 0.2, 0.6]),
  ].map(contains);
  if (samples.every(Boolean)) return [{ points, accepted: true }];
  if (samples.every((sample) => !sample) || depth >= 4) {
    return [{ points, accepted: false }];
  }
  const [a, b, c] = points;
  const ab = sphericalMidpoint(a, b);
  const bc = sphericalMidpoint(b, c);
  const ca = sphericalMidpoint(c, a);
  return [
    [a, ab, ca],
    [ab, b, bc],
    [ca, bc, c],
    [ab, bc, ca],
  ].flatMap((triangle) =>
    refineTriangleContainment(triangle, contains, countryId, depth + 1),
  );
}

function transportRoundTripVector(point) {
  return lonLatToXyz(point).map(
    (value) => Math.round(Math.max(-1, Math.min(1, value)) * 32767) / 32767,
  );
}

function weightedVectorPoint(vectors, weights) {
  const xyz = [0, 0, 0];
  vectors.forEach((vector, index) => {
    xyz[0] += vector[0] * weights[index];
    xyz[1] += vector[1] * weights[index];
    xyz[2] += vector[2] * weights[index];
  });
  const length = Math.hypot(...xyz);
  return [Math.atan2(xyz[1], xyz[0]) / DEG, Math.asin(xyz[2] / length) / DEG];
}

function boundaryCollection(countries) {
  return {
    type: 'MultiLineString',
    coordinates: countries.features.flatMap((country) =>
      polygonsOf(country.geometry).flatMap((polygon) => polygon),
    ),
  };
}

function lineGeometry(geometry, maxEdgeDegrees, radius) {
  const positions = [];
  const indices = [];
  const lines =
    geometry.type === 'LineString'
      ? [geometry.coordinates]
      : (geometry.coordinates ?? []);
  for (const line of lines) {
    for (let index = 1; index < line.length; index += 1) {
      const points = subdivideLine(
        line[index - 1],
        line[index],
        maxEdgeDegrees,
      );
      for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
        const base = positions.length / 3;
        positions.push(...lonLatToXyz(points[pointIndex - 1], radius));
        positions.push(...lonLatToXyz(points[pointIndex], radius));
        indices.push(base, base + 1);
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    indices: typedIndices(indices, positions.length / 3),
  };
}

function subdivideLine(a, b, maxEdgeDegrees) {
  if (angularDistanceDegrees([a, b]) <= maxEdgeDegrees) return [a, b];
  const midpoint = sphericalMidpoint(a, b);
  const left = subdivideLine(a, midpoint, maxEdgeDegrees);
  const right = subdivideLine(midpoint, b, maxEdgeDegrees);
  return [...left.slice(0, -1), ...right];
}

function typedIndices(values, vertexCount) {
  return vertexCount <= 65_535
    ? new Uint16Array(values)
    : new Uint32Array(values);
}

export function createPalette(countryCount) {
  const data = new Uint8Array(countryCount * 4);
  const texture = new DataTexture(
    data,
    countryCount,
    1,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

export function updatePalette(texture, colors) {
  for (const [countryIndex, color] of colors) {
    texture.image.data.set(color, countryIndex * 4);
  }
  texture.needsUpdate = true;
}

export function encodeVectorAsset(result) {
  const arrays = [
    ['position', result.surface.positions],
    ['countryIndex', result.surface.countryIndices],
    ['surfaceIndex', result.surface.indices],
    ['coastPosition', result.coastline.positions],
    ['coastIndex', result.coastline.indices],
    ['borderPosition', result.borders.positions],
    ['borderIndex', result.borders.indices],
  ];
  const metadata = Buffer.from(
    JSON.stringify({
      version: 1,
      countries: result.countries,
      arrays: arrays.map(([name, array]) => ({
        name,
        type: array.constructor.name,
        length: array.length,
        byteLength: array.byteLength,
      })),
    }),
  );
  const header = Buffer.alloc(8);
  header.write('MVG1');
  header.writeUInt32LE(metadata.length, 4);
  const chunks = [header, metadata];
  for (const [, array] of arrays) {
    while (chunks.reduce((sum, chunk) => sum + chunk.length, 0) % 4 !== 0) {
      chunks.push(Buffer.alloc(1));
    }
    chunks.push(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  }
  return Buffer.concat(chunks);
}
