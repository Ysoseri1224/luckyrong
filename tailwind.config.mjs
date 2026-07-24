/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        plum: {
          50: '#faf7fc',
          100: '#f0e8f4',
          200: '#e0d0e8',
          300: '#c9a0b5',
          400: '#a88a9e',
          500: '#8a6b80',
          600: '#6b5068',
          700: '#543d52',
          800: '#3d2a3e',
          900: '#2d2a3e',
        },
        lavender: {
          100: '#ede8f5',
          200: '#d5cceb',
          300: '#b8abd9',
          400: '#9b8ec4',
          500: '#7e6faf',
          600: '#6558a0',
          700: '#4f4488',
        },
        rose: {
          100: '#fce8e8',
          200: '#f5cccc',
          300: '#e8a0a0',
          500: '#c9707a',
        },
      },
    },
  },
  plugins: [],
};
