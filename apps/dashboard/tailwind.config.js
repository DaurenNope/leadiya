/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f5f7ff',
          100: '#ebf0fe',
          200: '#ccd9fd',
          300: '#adByfb',
          400: '#6e8dfa',
          500: '#2f59f8',
          600: '#2a50df',
          700: '#2343ba',
          800: '#1c3695',
          900: '#172c7a',
        },
      },
    },
  },
  plugins: [],
}
