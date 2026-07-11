import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// base: './' — относительные пути ассетов, чтобы одинаково работало
// и локально (npm run preview), и на GitHub Pages в подкаталоге /stuff/.
export default defineConfig({
  base: './',
  plugins: [vue()],
})
