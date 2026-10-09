import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2022',
    // The public V1 artifact intentionally excludes browser source maps.
    sourcemap: false,
    // Vite emits the exact bundled dependency notices into the deployed artifact.
    license: { fileName: 'THIRD_PARTY_NOTICES.md' },
    // Three.js is intentionally isolated as a cacheable 190 kB gzip vendor chunk.
    chunkSizeWarningLimit: 750,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
          if (id.includes('/node_modules/@react-three/')) return 'react-three';
          if (
            id.includes('/node_modules/d3-geo/') ||
            id.includes('/node_modules/topojson-client/') ||
            // Only the 110m picking topology is shared; the 50m topology
            // belongs to the lazily loaded Surname Atlas runtime chunk.
            id.includes('/src/data/generated/mundus-countries-110m.json')
          ) {
            return 'geo';
          }
        },
      },
    },
  },
});
