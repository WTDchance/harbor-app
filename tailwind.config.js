/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Harbor Brand Palette
        'harbor': {
          navy: '#1f375d',      // Primary dark — headers, text, dark backgrounds
          teal: '#52bfc0',      // Primary accent — buttons, links, active states
          blue: '#3e85af',      // Secondary accent — hover states, supporting elements
          'teal-light': '#e8f8f8', // Light teal for backgrounds
          'teal-dark': '#3a9fa0',  // Darker teal for hover on buttons
          'navy-light': '#2a4a73', // Lighter navy for hover
        },
        // Keep teal alias for gradual migration (maps to Harbor teal)
        'teal': {
          50: '#e8f8f8',
          100: '#d1f0f0',
          400: '#6ecfd0',
          500: '#52bfc0',
          600: '#52bfc0',
          700: '#3a9fa0',
          800: '#2d7f80',
          900: '#1f5f60',
        },
      },
      fontFamily: {
        sans: ['system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
