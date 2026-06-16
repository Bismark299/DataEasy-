/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./*.html",
    "./pages/**/*.html",
    "./admin/**/*.html",
    "./store/**/*.html",
    "./assets/js/**/*.js"
  ],
  theme: {
    screens: {
      'xs': '400px',
      'sm': '640px',
      'md': '768px',
      'lg': '1024px',
      'xl': '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        // Admin sidebar
        'sidebar': '#1a1f36',
        // User-facing colors
        'mtn-yellow': '#F5C518',
        'dark-bg': '#1a1a2e',
        'card-bg': '#16213e',
        'airtel-red': '#E4002B',
        'airtel-blue': '#0033A0',
        'telecel-red': '#E53935',
      }
    }
  },
  plugins: [],
}
