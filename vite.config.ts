import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'restore-js',
      fileName: (format) => `restore-js.${format}.js`,
    },
    rollupOptions: {
      output: {
        globals: {
          react: 'React'
        }
      }
    }
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
    exclude: ['restore-js']
  }
});
