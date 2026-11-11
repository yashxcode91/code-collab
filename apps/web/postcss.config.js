import { fileURLToPath, URL } from 'node:url';

// Wire Tailwind + Autoprefixer explicitly from this directory so monorepo builds always find tailwind.config.js
export default {
  plugins: {
    tailwindcss: {
      config: fileURLToPath(new URL('./tailwind.config.js', import.meta.url)),
    },
    autoprefixer: {},
  },
};
