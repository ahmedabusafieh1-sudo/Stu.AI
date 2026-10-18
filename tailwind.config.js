/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        stu: {
          bg: '#171717',
          sidebar: '#111111',
          card: '#232323',
          input: '#2B2B2B',
          text: '#F5F5F5',
          secondary: '#B5B5B5',
          border: '#3A3A3A',
          hover: '#2f2f2f',
          accent: '#ffffff',
          'accent-hover': '#e5e5e5',
          error: '#ef4444',
          'error-bg': '#451a1a',
          success: '#10b981',
          'success-bg': '#064e3b',
          warning: '#f59e0b',
          blue: '#3b82f6',
        }
      },
      fontFamily: {
        arabic: ['"Noto Sans Arabic"', 'system-ui', '-apple-system', 'sans-serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      minHeight: {
        'screen-dvh': '100dvh',
      },
      height: {
        'screen-dvh': '100dvh',
      }
    },
  },
  plugins: [],
}
