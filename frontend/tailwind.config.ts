import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        ember: {
          50: '#fff5ec',
          100: '#ffe8d3',
          200: '#ffd0a7',
          300: '#ffb06f',
          400: '#fb8337',
          500: '#eb6216',
          600: '#cc4a0d',
          700: '#a9380d',
          800: '#872f12',
          900: '#6d2912'
        },
        slatewarm: {
          950: '#111316'
        }
      },
      boxShadow: {
        card: '0 18px 50px rgba(17, 19, 22, 0.15)'
      },
      backgroundImage: {
        grid: 'linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)'
      }
    }
  },
  plugins: []
};

export default config;
