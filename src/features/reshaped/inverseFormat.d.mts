export interface InverseField {
  width: number;
  height: number;
  data: Float32Array;
  header?: {
    formatVersion: number;
    metric: string;
    level: string;
    stepLongitude: number;
    stepS: number;
  };
}
export function decodeInverse(
  buffer: ArrayBuffer,
  expected: { metric: string; level: string },
): Promise<InverseField>;
