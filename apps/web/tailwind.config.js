import { fileURLToPath, URL } from 'node:url';

// Resolve paths relative to this config file so Tailwind works whether invoked from repo root or `apps/web`
const fromWebRoot = (relativePath) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  // Toggle dark mode manually by adding `.dark` on <html> instead of relying only on OS media queries
  darkMode: 'class',
  content: [
    fromWebRoot('./index.html'),
    fromWebRoot('./src/**/*.{js,ts,jsx,tsx}'),
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Geist Variable"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"Geist Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      // Read HSL channels from `index.css` so Tailwind opacity modifiers (e.g. `bg-primary/20`) work seamlessly
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        panel: 'hsl(var(--panel) / <alpha-value>)',
        editor: {
          DEFAULT: 'hsl(var(--editor) / <alpha-value>)',
          bar: 'hsl(var(--editor-bar) / <alpha-value>)',
        },
      },
      boxShadow: {
        'panel-card':
          '0 1px 2px 0 rgb(0 0 0 / 0.04), 0 12px 32px -8px rgb(15 23 42 / 0.08)',
        'panel-card-dark':
          '0 1px 0 0 rgb(255 255 255 / 0.05) inset, 0 20px 50px -12px rgb(0 0 0 / 0.65)',
      },
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
      },
      animation: {
        'pulse-soft': 'pulse-soft 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
