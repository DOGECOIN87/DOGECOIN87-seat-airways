/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,css}'],
  theme: {
    extend: {
      colors: {
        /* ── The interface ────────────────────────────────────────────
           A soft-UI kit: one light ground, panels extruded out of it by
           light rather than drawn with borders, and a single blue gradient
           doing every job an accent has to do. Nothing here is a hue
           chosen for decoration — the greys are all the same grey at
           different distances from the light. */
        /* Every grey here carries small text at 4.5:1 on the page, on a
           card, on the wall band and in a recess — the kit's own greys
           were set for looking at rather than for reading. These values
           must stay in step with the custom properties in index.css;
           they are the same palette reached two different ways. */
        ui: {
          bg:      '#DFE0E4',  // the ground everything is pressed out of
          sink:    '#D6D7DC',  // a recess: search fields, empty sockets
          surface: '#EDEEF1',  // a raised panel
          hi:      '#F7F7F9',  // the lit top edge of one
          off:     '#D0D1D3',  // a control that is off
          line:    '#C7C9D1',  // a seam, where one is unavoidable
          ink:     '#24282F',  // headings and figures
          soft:    '#4F545C',  // body copy
          faint:   '#585D66',  // labels, units, the quiet half of a pair
          cyan:    '#00C9F1',  // the gradient starts here
          blue:    '#0087EA',  // and ends here
          mid:     '#01A5ED',  // the solid, where a gradient would be noise
          /* The same blue walked down until it carries small text at 4.5:1
             on the page ground. `blue` is for graphics, `deep` is for words. */
          deep:    '#005CAD',
        },
        /* ── The aircraft ─────────────────────────────────────────────
           Unchanged, and deliberately so. These are materials inside the
           dark screens the panel holds — the cabin with the lights down,
           the navy of the livery, the amber of integral lighting. The
           interface above is not made of them and must not borrow them. */
        seat: {
          night: '#0A0F16',
          panel: '#121824',
          edge:  '#28313F',
          navy:  '#002663',
          lift:  '#0A3C86',
          cloth: '#36445C',
          amber: '#FFB300',
          cyan:  '#7ECDE0',
          bone:  '#EDE6D8',
        },
        /* Copy inside the dark screens stays warm bone. */
        blue: { 100: '#E6E0D4' },
      },
      fontFamily: {
        sans: ['Montserrat', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        heading: ['Montserrat', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      /* Soft UI is a rounded UI: nothing in the kit has a corner on it. */
      borderRadius: {
        none: '0',
        sm: '8px',
        DEFAULT: '12px',
        md: '14px',
        lg: '20px',
        xl: '26px',
        '2xl': '32px',
        '3xl': '40px',
        full: '9999px',
      },
    },
  },
  plugins: [],
};
