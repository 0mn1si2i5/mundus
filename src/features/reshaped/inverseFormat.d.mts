export interface InverseHeader {
  formatVersion: 3;
  encoding: 'regular-node-int16';
  width: number;
  height: number;
  metric: string;
  stepLongitude: number;
  stepS: number;
  stride: 4;
  encodedBytes: number;
}
export interface InverseField {
  width: number;
  height: number;
  encoding: 'regular-node-float32';
  data: Float32Array;
  header?: InverseHeader;
}
export const INVERSE_GRID: Readonly<{ width: 1024; height: 512 }>;
export function encodeInversePacket(
  payload: Uint8Array,
  descriptor: { metric: string; stepLongitude: number; stepS: number },
): { header: InverseHeader; bytes: Uint8Array };
export function decodeInverse(
  buffer: ArrayBuffer,
  expected: { metric: string },
): Promise<InverseField>;
