/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,css}'],
  theme: {
    extend: {
      colors: {
        /* The palette is the cabin's own. Every value here is a material in
           the aircraft the page is drawing: the sidewall's bone, the seat
           cloth's navy, the integral lighting's amber, the daylight coming
           through a window. Taking the interface's colours from the thing it
           depicts is what stops it reading like any other dark dashboard. */
        seat: {
          night: '#0A0F16',  // page ground — the cabin with the lights down
          panel: '#121824',  // cards and strips
          edge:  '#28313F',  // seams and borders
          navy:  '#002663',  // the mark's own navy; branded surfaces
          lift:  '#0A3C86',  // navy, one step up, for hovers
          cloth: '#36445C',  // seat fabric
          amber: '#FFB300',  // integral lighting: advisories, CTAs, your seat
          cyan:  '#7ECDE0',  // daylight through the glass: live data
          bone:  '#EDE6D8',  // sidewall cream
        },
        /* Body copy is warm bone, not cold blue — the tint every text scale in
           the page already reaches for. */
        blue: { 100: '#E6E0D4' },
      },
      fontFamily: {
        sans: ['"Instrument Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        heading: ['Archivo', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        none: '0', sm: '0', DEFAULT: '0', md: '0', lg: '0', xl: '0', '2xl': '0', '3xl': '0', full: '0',
      },
    },
  },
  plugins: [],
};
