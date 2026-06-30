import tailwindAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: '#C17754',
          hover: '#A35D3B',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        sand: {
          50: '#FBFBFA',
          100: '#F5EFE6',
          200: '#E6DCC8',
          300: '#D4C4A8',
          400: '#BCA888',
          500: '#A39171',
          600: '#8A795D',
          700: '#685A44',
          800: '#4A402E',
          900: '#2E281C',
        },
        success: {
          DEFAULT: '#6B8E6B',
        },
        danger: {
          DEFAULT: '#B85C5C',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Oxygen',
          'Ubuntu',
          'Cantarell',
          'Open Sans',
          'Helvetica Neue',
          'sans-serif',
        ],
      },
      maxWidth: {
        container: '800px',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        card: '20px',
      },
      boxShadow: {
        sm: '0 1px 3px rgba(56, 36, 13, 0.05)',
        md: '0 4px 12px rgba(56, 36, 13, 0.08)',
        lg: '0 12px 24px rgba(56, 36, 13, 0.12)',
      },
    },
  },
  plugins: [tailwindAnimate],
};
