import tailwindTypography from '@tailwindcss/typography'
import tailwindColors from 'tailwindcss/colors'

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  // Safelist status badge dark mode classes that are dynamically generated
  safelist: [
    // Status badge colors - explicit dark/light mode variants
    '!bg-blue-500/10', '!text-blue-700', '!border-blue-200', 'dark:!bg-blue-500/20', 'dark:!text-blue-300', 'dark:!border-blue-700/50',
    '!bg-emerald-500/10', '!text-emerald-700', '!border-emerald-200', 'dark:!bg-emerald-500/20', 'dark:!text-emerald-300', 'dark:!border-emerald-700/50',
    '!bg-red-500/10', '!text-red-700', '!border-red-200', 'dark:!bg-red-500/20', 'dark:!text-red-300', 'dark:!border-red-700/50',
    '!bg-amber-500/10', '!text-amber-700', '!border-amber-200', 'dark:!bg-amber-500/20', 'dark:!text-amber-300', 'dark:!border-amber-700/50',
    '!bg-purple-500/10', '!text-purple-700', '!border-purple-200', 'dark:!bg-purple-500/20', 'dark:!text-purple-300', 'dark:!border-purple-700/50',
    '!bg-muted/40', '!text-muted-foreground', '!border-border/60'
  ],
  prefix: '',
  theme: {
  	container: {
  		center: true,
  		padding: '2rem',
  		screens: {
  			'2xl': '1400px'
  		}
  	},
  	colors: (() => {
		// Exclude deprecated color names to silence Tailwind v3 warnings
		const { lightBlue, warmGray, trueGray, coolGray, blueGray, ...colors } = tailwindColors
		return {
			...colors,
			// Custom semantic colors (override defaults)
			transparent: 'transparent',
			current: 'currentColor',
			white: '#ffffff',
			black: '#000000',
			border: 'hsl(var(--border))',
			input: 'hsl(var(--input))',
			ring: 'hsl(var(--ring))',
			background: 'hsl(var(--background))',
			foreground: 'hsl(var(--foreground))',
			primary: {
				DEFAULT: 'hsl(var(--primary))',
				foreground: 'hsl(var(--primary-foreground))'
			},
			secondary: {
				DEFAULT: 'hsl(var(--secondary))',
				foreground: 'hsl(var(--secondary-foreground))'
			},
			destructive: {
				DEFAULT: 'hsl(var(--destructive))',
				foreground: 'hsl(var(--destructive-foreground))'
			},
			muted: {
				DEFAULT: 'hsl(var(--muted))',
				foreground: 'hsl(var(--muted-foreground))'
			},
			accent: {
				DEFAULT: 'hsl(var(--accent))',
				foreground: 'hsl(var(--accent-foreground))'
			},
			popover: {
				DEFAULT: 'hsl(var(--popover))',
				foreground: 'hsl(var(--popover-foreground))'
			},
			card: {
				DEFAULT: 'hsl(var(--card))',
				foreground: 'hsl(var(--card-foreground))'
			},
			// Text Tertiary: #7A7C80
			tertiary: {
				DEFAULT: '#7A7C80',
				foreground: '#7A7C80'
			},
		}
	})(),
  	extend: {
  		fontFamily: {
  			sans: [
  				'DM Sans"',
  				'-apple-system',
  				'BlinkMacSystemFont',
  				'Segoe UI"',
  				'sans-serif'
  			],
  			mono: [
  				'IBM Plex Mono"',
  				'SFMono-Regular',
  				'Consolas',
  				'monospace'
  			]
  		},
  		fontSize: {
  			xs: [
  				'0.75rem',
  				{
  					lineHeight: '1rem'
  				}
  			],
  			sm: [
  				'0.875rem',
  				{
  					lineHeight: '1.25rem'
  				}
  			],
  			base: [
  				'1rem',
  				{
  					lineHeight: '1.5rem'
  				}
  			],
  			lg: [
  				'1.125rem',
  				{
  					lineHeight: '1.75rem'
  				}
  			],
  			xl: [
  				'1.25rem',
  				{
  					lineHeight: '1.75rem'
  				}
  			],
  			'2xl': [
  				'1.5rem',
  				{
  					lineHeight: '2rem'
  				}
  			],
  			'3xl': [
  				'1.875rem',
  				{
  					lineHeight: '2.25rem'
  				}
  			]
  		},
  		spacing: {
  			'1': '0.25rem',
  			'2': '0.5rem',
  			'3': '0.75rem',
  			'4': '1rem',
  			'5': '1.25rem',
  			'6': '1.5rem',
  			'8': '2rem',
  			'12': '3rem'
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [tailwindTypography],
}
