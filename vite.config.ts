import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('three/examples')) return 'three-extras';
          if (id.includes('three.core')) return 'three-core';
          if (id.includes('/three/') || id.includes('\\three\\')) return 'three-module';
          if (id.includes('konva') || id.includes('react-konva')) return 'konva-vendor';
          if (id.includes('dexie')) return 'dexie-vendor';
          if (id.includes('lucide-react') || id.includes('qrcode.react')) return 'ui-vendor';
          return undefined;
        },
      },
    },
  },
})
