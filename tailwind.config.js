// Tailwind is compiled at build time (it used to run in the browser from
// cdn.tailwindcss.com, which made every page load depend on that CDN).
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './App.tsx', './components/**/*.tsx', './hooks/**/*.ts', './services/**/*.ts'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#F2F8F5',
          100: '#E1F0E9',
          200: '#C3E1D4',
          300: '#94C9B4',
          400: '#57A689',
          500: '#1F6E58',
          600: '#185846',
          700: '#144739',
          800: '#113A2F',
          900: '#0C2921',
        },
        ink: { DEFAULT: '#18221E', soft: '#26332E', muted: '#57635E' },
        flame: { 500: '#D95A1B' }, // the count of cards due
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
