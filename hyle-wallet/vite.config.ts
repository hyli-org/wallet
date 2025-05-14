import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'HyleWallet',
      fileName: (format) => `hyle-wallet.${format}.js`,
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'hyle-check-secret',
        'barretenberg',
        'barretenberg/threads'
      ],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM'
        }
      }
    },
    outDir: 'dist'
  },
  plugins: [
    react(),
    dts({
      entryRoot: 'src',
      insertTypesEntry: true
    }),
    cssInjectedByJsPlugin()
  ],
});
