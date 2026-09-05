/* Tailwind CSS build config (v3) — replaces the Play CDN runtime compiler.
   Content scan includes JS templates so dynamically-rendered classes are kept.
   Build: npx tailwindcss@3.4.17 -i css/tailwind-input.css -o css/tailwind.css */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './js/*.js', './css/styles.css'],
  theme: {
    extend: {
      colors: {
        cream: {
          50: '#FFFDF5', 100: '#FFF8E7', 200: '#F7EED8', 300: '#EFE3C3'
        },
        amberdeep: {
          400: '#D97706', 500: '#B45309', 600: '#92400E', 700: '#78350F', 800: '#5B2A0A'
        },
        emeraldx: {
          400: '#34D399', 500: '#10B981', 600: '#059669', 700: '#047857'
        }
      }
    }
  },
  plugins: []
};