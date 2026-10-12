export function decodePngRgb(
  buffer: ArrayBuffer,
  options?: { sample?: 1 | 2 },
): Promise<{ width: number; height: number; ids: Uint32Array }>;
