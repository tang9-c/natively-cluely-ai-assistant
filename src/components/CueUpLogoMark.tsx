import React from 'react';

/**
 * CueUp logomark: a compact C-shaped sound wave.
 * The mark avoids N letterforms and inherits currentColor for UI contexts.
 */
export const CueUpLogoMark: React.FC<{
  size?: number;
  className?: string;
}> = ({ size = 18, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M63 24C56.9 20.4 49.5 19.3 42.6 21.1C28 24.9 18.8 39.1 22.1 53.7C25.4 68.2 39.4 77.6 54.1 74.6C57.3 73.9 60.3 72.8 63 71.1"
      stroke="currentColor"
      strokeWidth="10"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M69 34C74.3 38.2 77.5 44.2 77.5 50.5C77.5 56.8 74.3 62.7 69 67"
      stroke="currentColor"
      strokeWidth="7"
      strokeLinecap="round"
    />
    <path
      d="M81 25C88.5 31.7 92.5 40.6 92.5 50.5C92.5 60.3 88.5 69.3 81 76"
      stroke="currentColor"
      strokeWidth="7"
      strokeLinecap="round"
    />
  </svg>
);
