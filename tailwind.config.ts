import type { Config } from "tailwindcss";

/**
 * Design tokens lifted from Phase2-Mockup-V4.html (light theme, indigo-on-white).
 * Light theme only — no dark mode. All tokens map to CSS custom properties
 * defined in app/globals.css so raw CSS and Tailwind classes share one source.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  // Explicitly disable dark-mode class generation — this app is light-theme only.
  darkMode: ["class", '[data-theme="never-dark"]'],
  theme: {
    extend: {
      colors: {
        // Surface + text (V4 tokens)
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-alt": "var(--surface-alt)",
        border: "var(--border)",
        "border-soft": "var(--border-soft)",
        text: "var(--text)",
        "text-dim": "var(--text-dim)",
        "text-faint": "var(--text-faint)",

        // Indigo accent family (V4)
        accent: {
          DEFAULT: "var(--accent)",        // #4f46e5
          dark: "var(--accent-dark)",      // #4338ca
          light: "var(--accent-light)",    // #eef2ff
          softer: "var(--accent-softer)",  // #f5f3ff
        },

        // Status palette (V4)
        green: "var(--green)",
        "green-light": "var(--green-light)",
        red: "var(--red)",
        "red-light": "var(--red-light)",
        amber: "var(--amber)",
        "amber-light": "var(--amber-light)",

        // Campaign-intent badges (V4 type-badge-*)
        "intent-investor-bg": "var(--accent-light)",
        "intent-investor-fg": "var(--accent)",
        "intent-investor-border": "#d7d5fc",
        "intent-customer-bg": "#dcfce7",
        "intent-customer-fg": "#14532d",
        "intent-customer-border": "#86efac",
        "intent-supplier-bg": "#fef3c7",
        "intent-supplier-fg": "#78350f",
        "intent-supplier-border": "#fcd34d",

        // Email-tier badges — derived from V4-FEEDBACK-ROUND-2.md §"Verification tiers".
        // Only `corresponded` and `hunter_verified` can advance a partner to +2 Drafted.
        "tier-corresponded-bg": "#dcfce7",
        "tier-corresponded-fg": "#14532d",
        "tier-corresponded-border": "#86efac",
        "tier-hunter-bg": "var(--accent-light)",
        "tier-hunter-fg": "var(--accent)",
        "tier-hunter-border": "#d7d5fc",
        "tier-unverified-bg": "#fef3c7",
        "tier-unverified-fg": "#78350f",
        "tier-unverified-border": "#fcd34d",
        "tier-generic-bg": "var(--red-light)",
        "tier-generic-fg": "var(--red)",
        "tier-generic-border": "#fecaca",
        "tier-bounced-bg": "#fee2e2",
        "tier-bounced-fg": "#991b1b",
        "tier-bounced-border": "#fca5a5",

        // Status-chip families (V4 tag-chip.*)
        "chip-status-bg": "var(--accent-light)",
        "chip-status-fg": "var(--accent)",
        "chip-status-border": "#e0dcff",
        "chip-approved-bg": "var(--green-light)",
        "chip-approved-fg": "var(--green)",
        "chip-approved-border": "#bbf7d0",
        "chip-blocked-bg": "var(--red-light)",
        "chip-blocked-fg": "var(--red)",
        "chip-blocked-border": "#fecaca",
        "chip-warn-bg": "#fff7ed",
        "chip-warn-fg": "var(--amber)",
        "chip-warn-border": "#fed7aa",
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        sm: "var(--radius-sm)",
      },
      boxShadow: {
        DEFAULT: "var(--shadow)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
