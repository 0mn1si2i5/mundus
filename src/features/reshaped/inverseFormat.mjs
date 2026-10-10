import { MeshoptDecoder } from 'meshoptimizer/decoder';
import {
  ADAPTIVE_MAX_DEPTH,
  ADAPTIVE_LEAF_BIT,
  ADAPTIVE_LEAF_MASK,
  inverseTextureBytes,
} from './inverseSampling.mjs';

const powerOfTwo = (value) =>
  Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
const integer = (value, low, high) =>
  Number.isInteger(value) && value >= low && value <= high;

function validateTree(field) {
  const { tree, corners, width, height, header } = field;
  const roots = width * height;
  const seenNodes = new Uint8Array(tree.length);
  const seenLeaves = new Uint8Array(header.leafCount);
  const stack = [];
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      stack.push([y * width + x, 0, y === 0, y === height - 1]);
  let nodes = 0,
    leaves = 0;
  while (stack.length) {
    const [node, depth, south, north] = stack.pop();
    if (node >= tree.length || seenNodes[node] || depth > header.maxDepth)
      throw new Error('Invalid cartogram tree node');
    seenNodes[node] = 1;
    nodes += 1;
    const word = tree[node];
    if ((word & ADAPTIVE_LEAF_BIT) !== 0) {
      const leaf = word & ADAPTIVE_LEAF_MASK;
      if (leaf >= header.leafCount || seenLeaves[leaf])
        throw new Error('Invalid cartogram tree leaf');
      seenLeaves[leaf] = 1;
      leaves += 1;
      const at = leaf * 8;
      if (
        (south && (corners[at + 1] !== 0 || corners[at + 3] !== 0)) ||
        (north && (corners[at + 5] !== 0 || corners[at + 7] !== 0))
      )
        throw new Error('Invalid cartogram reflecting pole');
    } else {
      if (
        word < roots ||
        word <= node ||
        word + 3 >= tree.length ||
        depth === header.maxDepth
      )
        throw new Error('Invalid cartogram child pointer');
      for (let q = 0; q < 4; q += 1)
        stack.push([word + q, depth + 1, south && q < 2, north && q >= 2]);
    }
  }
  if (nodes !== tree.length || leaves !== header.leafCount)
    throw new Error('Cartogram tree has unreachable data');
  if (inverseTextureBytes(field) > 12 * 1024 ** 2)
    throw new Error('Cartogram inverse exceeds the GPU field budget');
}

export async function decodeInverse(buffer, expected) {
  if (buffer.byteLength < 8 || buffer.byteLength > 8 * 1024 ** 2)
    throw new Error('Invalid cartogram file length');
  const bytes = new Uint8Array(buffer),
    view = new DataView(buffer);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== 'MRE1' && magic !== 'MRE2')
    throw new Error('Invalid cartogram magic');
  const length = view.getUint32(4, true);
  if (!length || length > 4096 || length + 8 >= bytes.length)
    throw new Error('Invalid cartogram header length');
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length)));
  const adaptive = magic === 'MRE2';
  const width = adaptive ? h.width : expected.level === 'country' ? 512 : 1024,
    height = adaptive ? h.height : width / 2;
  if (
    h.formatVersion !== (adaptive ? 2 : 1) ||
    h.width !== width ||
    h.height !== height ||
    h.metric !== expected.metric ||
    h.level !== expected.level ||
    h.stride !== 4 ||
    h.encodedBytes !== bytes.length - 8 - length ||
    !Number.isFinite(h.stepLongitude) ||
    h.stepLongitude <= 0 ||
    h.stepLongitude > 0.02 ||
    (adaptive && h.verticalCoordinate === 'latitude'
      ? !Number.isFinite(h.stepLatitude) ||
        h.stepLatitude <= 0 ||
        h.stepLatitude > 0.02 ||
        h.stepS !== undefined
      : !Number.isFinite(h.stepS) ||
        h.stepS <= 0 ||
        h.stepS > 0.001 ||
        h.stepLatitude !== undefined) ||
    (h.verticalCoordinate !== undefined && h.verticalCoordinate !== 'latitude')
  )
    throw new Error('Invalid cartogram header');
  if (
    adaptive &&
    (h.encoding !== 'adaptive-quadtree-int16' ||
      !powerOfTwo(width) ||
      width > 1024 ||
      !powerOfTwo(height) ||
      height > 512 ||
      !integer(h.maxDepth, 0, ADAPTIVE_MAX_DEPTH) ||
      !integer(h.treeNodes, width * height, 2_000_000) ||
      !integer(h.leafCount, width * height, 750_000) ||
      !integer(h.treeEncodedBytes, 1, h.encodedBytes - 1) ||
      h.cornerEncodedBytes !== h.encodedBytes - h.treeEncodedBytes ||
      (h.treeNodes - width * height) % 4 !== 0 ||
      h.leafCount !==
        width * height + (3 * (h.treeNodes - width * height)) / 4 ||
      h.treeNodes * 4 + h.leafCount * 16 > 12 * 1024 ** 2)
  )
    throw new Error('Invalid adaptive cartogram header');
  await MeshoptDecoder.ready;
  if (adaptive) {
    const treeBytes = new Uint8Array(h.treeNodes * 4);
    const cornerBytes = new Uint8Array(h.leafCount * 16);
    const payload = bytes.subarray(8 + length);
    MeshoptDecoder.decodeVertexBuffer(
      treeBytes,
      h.treeNodes,
      4,
      payload.subarray(0, h.treeEncodedBytes),
    );
    MeshoptDecoder.decodeVertexBuffer(
      cornerBytes,
      h.leafCount * 4,
      4,
      payload.subarray(h.treeEncodedBytes),
    );
    const treeView = new DataView(treeBytes.buffer),
      cornerView = new DataView(cornerBytes.buffer);
    const tree = new Uint32Array(h.treeNodes),
      corners = new Int16Array(h.leafCount * 8);
    for (let i = 0; i < tree.length; i += 1)
      tree[i] = treeView.getUint32(i * 4, true);
    for (let i = 0; i < corners.length; i += 1)
      corners[i] = cornerView.getInt16(i * 2, true);
    const field = {
      width,
      height,
      encoding: h.encoding,
      tree,
      corners,
      header: h,
    };
    validateTree(field);
    return field;
  }
  const decoded = new Uint8Array(width * height * 4);
  MeshoptDecoder.decodeVertexBuffer(
    decoded,
    width * height,
    4,
    bytes.subarray(8 + length),
  );
  const values = new DataView(decoded.buffer),
    data = new Float32Array(width * height * 2);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 2] = values.getInt16(i * 4, true) * h.stepLongitude;
    data[i * 2 + 1] = values.getInt16(i * 4 + 2, true) * h.stepS;
  }
  return { width, height, encoding: 'regular-float32', data, header: h };
}
