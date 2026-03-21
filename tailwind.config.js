/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'teal': {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#16a34a',
          600: '#0f766e',
          700: '#0d5f5f',
          800: '#0a4f4f',
          900: '#083d3d',
        },
      },
      fontFamily: {
        sans: ['system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
