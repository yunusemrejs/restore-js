import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [dts()],
  build: {
    minify: "terser",
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
