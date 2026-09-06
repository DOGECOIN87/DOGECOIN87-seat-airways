/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,css}'],
  theme: {
    extend: {
      colors: {
        /* The aviation palette the instruments already draw with: graphite
           structure, amber integral lighting, cyan for data. */
        seat: {
          night: '#0B0E14', // page ground
          panel: '#141821', // cards and strips
          edge: '#2A313D',  // seams and borders
          amber: '#FFB300', // advisories, CTAs, your seat
          cyan: '#3FD8E8',  // live data
        },
      },
      fontFamily: {
        sans: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        heading: ['"Barlow Condensed"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        none: '0', sm: '0', DEFAULT: '0', md: '0', lg: '0', xl: '0', '2xl': '0', '3xl': '0', full: '0',
      },
    },
  },
  plugins: [],
};
