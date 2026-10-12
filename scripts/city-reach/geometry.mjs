export function mollweidePoint(x, y) {
  const radius = 6_378_137;
  const theta = Math.asin(Math.max(-1, Math.min(1, y / (Math.SQRT2 * radius))));
  const latitude = Math.asin(
    Math.max(-1, Math.min(1, (2 * theta + Math.sin(2 * theta)) / Math.PI)),
  );
  const longitude = (Math.PI * x) / (2 * Math.SQRT2 * radius * Math.cos(theta));
  return [(longitude * 180) / Math.PI, (latitude * 180) / Math.PI];
}

export function geoPackageGeometry(blob) {
  const bytes = Buffer.from(blob);
  if (bytes.toString('ascii', 0, 2) !== 'GP' || bytes[2] !== 0)
    throw new Error('Invalid GeoPackage geometry header');
  const envelope = (bytes[3] >> 1) & 7;
  const sizes = [0, 32, 48, 48, 64];
  if (sizes[envelope] === undefined || bytes[3] & 16)
    throw new Error('Unsupported or empty GeoPackage geometry');
  let offset = 8 + sizes[envelope];
  const geometry = () => {
    if (offset + 5 > bytes.length) throw new Error('Truncated WKB geometry');
    const little = bytes[offset++] === 1;
    const uint = () => {
      const value = little
        ? bytes.readUInt32LE(offset)
        : bytes.readUInt32BE(offset);
      offset += 4;
      return value;
    };
    const double = () => {
      const value = little
        ? bytes.readDoubleLE(offset)
        : bytes.readDoubleBE(offset);
      offset += 8;
      return value;
    };
    const rawType = uint();
    const dimensions = rawType >= 3000 ? 4 : rawType >= 1000 ? 3 : 2;
    const type = rawType % 1000;
    const point = () => {
      const value = [double(), double()];
      for (let index = 2; index < dimensions; index += 1) double();
      return value;
    };
    if (type === 1) return { type: 'Point', coordinates: point() };
    if (type === 3) {
      const count = uint();
      if (count > Math.floor((bytes.length - offset) / 4))
        throw new Error('Truncated WKB polygon rings');
      const rings = [];
      for (let ring = 0; ring < count; ring += 1) {
        const points = uint();
        if (points > Math.floor((bytes.length - offset) / (dimensions * 8)))
          throw new Error('Truncated WKB polygon points');
        rings.push(Array.from({ length: points }, point));
      }
      return { type: 'Polygon', coordinates: rings };
    }
    if (type === 6) {
      const count = uint();
      if (count > Math.floor((bytes.length - offset) / 5))
        throw new Error('Truncated WKB MultiPolygon');
      const coordinates = [];
      for (let index = 0; index < count; index += 1) {
        const polygon = geometry();
        if (polygon.type !== 'Polygon')
          throw new Error('Invalid WKB MultiPolygon member');
        coordinates.push(polygon.coordinates);
      }
      return { type: 'MultiPolygon', coordinates };
    }
    throw new Error(`Unsupported WKB geometry type ${rawType}`);
  };
  const result = geometry();
  if (offset !== bytes.length)
    throw new Error('Unexpected bytes after WKB geometry');
  return result;
}

export function mollweideGeometry(geometry) {
  if (geometry.type === 'Point')
    return {
      ...geometry,
      coordinates: mollweidePoint(...geometry.coordinates),
    };
  const polygon = (rings) =>
    rings.map((ring) => ring.map(([x, y]) => mollweidePoint(x, y)));
  if (geometry.type === 'Polygon')
    return { ...geometry, coordinates: polygon(geometry.coordinates) };
  if (geometry.type === 'MultiPolygon')
    return { ...geometry, coordinates: geometry.coordinates.map(polygon) };
  throw new Error(`Unsupported city geometry ${geometry.type}`);
}

function segmentTouchesCell(x1, y1, x2, y2, column, row) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let low = 0;
  let high = 1;
  for (const [p, q] of [
    [-dx, x1 - column],
    [dx, column + 1 - x1],
    [-dy, y1 - row],
    [dy, row + 1 - y1],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const ratio = q / p;
    if (p < 0) low = Math.max(low, ratio);
    else high = Math.min(high, ratio);
    if (low > high) return false;
  }
  return true;
}

/** Centre-in-polygon fill; optional exact segment/cell intersections add all_touched edges. */
export function rasterizeGeometry(
  geometry,
  grid,
  target,
  value,
  { allTouched = false } = {},
) {
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : null;
  if (!polygons) throw new Error(`Cannot rasterize ${geometry.type}`);
  for (const polygon of polygons) {
    const unwrapped = polygon.map((ring) => {
      let previous = null;
      return ring.map(([longitude, latitude]) => {
        let lon = longitude;
        if (previous !== null) {
          while (lon - previous > 180) lon -= 360;
          while (lon - previous < -180) lon += 360;
        }
        previous = lon;
        return [lon, latitude];
      });
    });
    for (const shift of [-360, 0, 360]) {
      const rings = unwrapped.map((ring) =>
        ring.map(([lon, lat]) => [
          (lon + shift - grid.west) / grid.step,
          (grid.north - lat) / grid.step,
        ]),
      );
      let lowY = Infinity;
      let highY = -Infinity;
      let minimumX = Infinity;
      let maximumX = -Infinity;
      for (const ring of rings)
        for (const [x, y] of ring) {
          lowY = Math.min(lowY, y);
          highY = Math.max(highY, y);
          minimumX = Math.min(minimumX, x);
          maximumX = Math.max(maximumX, x);
        }
      const minimumY = Math.max(0, Math.floor(lowY));
      const maximumY = Math.min(grid.height - 1, Math.floor(highY));
      if (maximumX < 0 || minimumX > grid.width || maximumY < minimumY)
        continue;
      for (let row = minimumY; row <= maximumY; row += 1) {
        const y = row + 0.5;
        const crossings = [];
        for (const ring of rings) {
          for (let index = 1; index < ring.length; index += 1) {
            const [x1, y1] = ring[index - 1];
            const [x2, y2] = ring[index];
            if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y))
              crossings.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
          }
        }
        crossings.sort((a, b) => a - b);
        for (let index = 0; index + 1 < crossings.length; index += 2) {
          const left = Math.max(0, Math.ceil(crossings[index] - 0.5));
          const right = Math.min(
            grid.width - 1,
            Math.floor(crossings[index + 1] - 0.5),
          );
          if (right >= left)
            target.fill(
              value,
              row * grid.width + left,
              row * grid.width + right + 1,
            );
        }
      }
      if (!allTouched) continue;
      for (const ring of rings) {
        for (let index = 1; index < ring.length; index += 1) {
          const [x1, y1] = ring[index - 1];
          const [x2, y2] = ring[index];
          const firstRow = Math.max(0, Math.floor(Math.min(y1, y2)) - 1);
          const lastRow = Math.min(
            grid.height - 1,
            Math.floor(Math.max(y1, y2)),
          );
          // Bound each row to the segment's intersections, avoiding a diagonal bounding-box scan.
          for (let row = firstRow; row <= lastRow; row += 1) {
            const dy = y2 - y1;
            const low =
              dy === 0
                ? 0
                : Math.max(0, Math.min((row - y1) / dy, (row + 1 - y1) / dy));
            const high =
              dy === 0
                ? 1
                : Math.min(1, Math.max((row - y1) / dy, (row + 1 - y1) / dy));
            if (low > high) continue;
            const a = x1 + low * (x2 - x1);
            const b = x1 + high * (x2 - x1);
            const firstColumn = Math.max(0, Math.floor(Math.min(a, b)) - 1);
            const lastColumn = Math.min(
              grid.width - 1,
              Math.floor(Math.max(a, b)),
            );
            for (let column = firstColumn; column <= lastColumn; column += 1) {
              if (segmentTouchesCell(x1, y1, x2, y2, column, row))
                target[row * grid.width + column] = value;
            }
          }
        }
      }
    }
  }
}
