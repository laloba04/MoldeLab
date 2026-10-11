import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Rutas relativas: la app funciona igual en local que servida bajo una
  // subruta (GitHub Pages la sirve en /MoldeLab/).
  base: './',
  plugins: [react()],
  // Dos páginas: la de siempre y la de novedades, cada una con su dirección.
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        novedades: 'novedades/index.html',
      },
    },
  },
});
