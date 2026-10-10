export function decodePngRgb(
  buffer: ArrayBuffer,
): Promise<{ width: number; height: number; ids: Uint32Array }>;
