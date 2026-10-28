// Tailwind is compiled at build time (it used to run in the browser from
// cdn.tailwindcss.com, which made every page load depend on that CDN).
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './App.tsx', './components/**/*.tsx', './hooks/**/*.ts', './services/**/*.ts'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: { 50: '#F3F2FE', 100: '#ECEAFD', 200: '#DCD8FB', 300: '#B9B1F6', 400: '#7D70E6', 500: '#4B3FD1', 600: '#3F34B8', 700: '#352B9E', 800: '#2E2591', 900: '#1E1866' },
        ink: { DEFAULT: '#171A33', soft: '#242849', muted: '#5A5F7A' },
        flame: { 500: '#E8590C' }, // the count of cards due
      },
      fontFamily: {
        fa: ['"Vazirmatn Variable"', 'Vazirmatn', 'system-ui', 'sans-serif'],
        en: ['"Outfit Variable"', 'Outfit', '"Plus Jakarta Sans Variable"', 'system-ui', 'sans-serif'],
        read: ['"Literata Variable"', 'Literata', 'Georgia', 'serif'],
      },
      keyframes: {
        'reveal': {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'flip-in': {
          '0%': { transform: 'rotateY(90deg)', opacity: '0' },
          '100%': { transform: 'rotateY(0deg)', opacity: '1' },
        },
        'toast-in': {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'fab-in': {
          '0%': { transform: 'scale(0.5)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      animation: {
        'reveal': 'reveal 0.25s ease-out',
        'flip-in': 'flip-in 0.4s ease-out',
        'toast-in': 'toast-in 0.3s ease-out',
        'fab-in': 'fab-in 0.2s ease-out',
      },
    },
  },
  plugins: [],
};
