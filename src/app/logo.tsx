/**
 * Aegyo Arena bunny mark, traced as stroke-based SVG from the brand
 * reference (render-checked against it over 4 iterations; final 5% is
 * Mateo's art-direction call on the live preview). Inline so it sizes
 * via className; color fixed to brand pink.
 */

export function AegyoLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 96 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M20 47 C21.5 36 25.5 24 30 18.5 C32 15.4 38.5 15.4 40.5 18.5 C43 22.8 45.5 33 46.8 41.5 C47.4 44.5 48 46.8 48 46.8 C48 46.8 48.6 44.5 49.2 41.5 C50.5 33 53 22.8 55.5 18.5 C57.5 15.4 64 15.4 66 18.5 C70.5 24 74.5 36 76 47 C77.3 55.5 78 65.5 77.4 71.5 C76.6 79.8 71.5 83.8 62.5 84.9 C53 86 43 86 33.5 84.9 C24.5 83.8 19.4 79.8 18.6 71.5 C18 65.5 18.7 55.5 20 47 Z"
        stroke="#ff4f8b"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M22.5 46.5 H44.5 M51.5 46.5 H73.5"
        stroke="#ff4f8b"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <circle cx="38" cy="64" r="5.5" stroke="#ff4f8b" strokeWidth="5" />
      <circle cx="58" cy="64" r="5.5" stroke="#ff4f8b" strokeWidth="5" />
    </svg>
  );
}
