/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'media',
  content: [
    './src/renderer/**/*.{ts,tsx}',
    './src/renderer/**/*.html',
    './src/popover/**/*.{ts,tsx}',
    './src/popover/**/*.html',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--bg-primary)',
        foreground: 'var(--text-primary)',
        muted: {
          DEFAULT: 'var(--bg-secondary)',
          foreground: 'var(--text-secondary)',
        },
        border: 'var(--border-default)',
        input: 'var(--border-default)',
        ring: 'var(--accent)',
        primary: {
          DEFAULT: 'var(--accent)',
          foreground: '#ffffff',
        },
        secondary: {
          DEFAULT: 'var(--bg-secondary)',
          foreground: 'var(--text-secondary)',
        },
        destructive: {
          DEFAULT: 'var(--status-error)',
          foreground: '#ffffff',
        },
        accent: {
          DEFAULT: 'var(--accent-bg)',
          foreground: 'var(--accent)',
        },
        popover: {
          DEFAULT: 'var(--bg-elevated)',
          foreground: 'var(--text-primary)',
        },
        card: {
          DEFAULT: 'var(--bg-elevated)',
          foreground: 'var(--text-primary)',
        },
      },
      borderRadius: {
        lg: 'var(--radius-md)',
        md: 'var(--radius-sm)',
        sm: 'calc(var(--radius-sm) - 2px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      ringOffsetColor: {
        background: 'var(--bg-primary)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
