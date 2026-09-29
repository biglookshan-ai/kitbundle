/** Small inline SVG icons for the kb kit (replaces @shopify/polaris-icons). */
import type { ReactNode } from "react";

type P = { size?: number };
const svg = (size: number, path: ReactNode) => (
  <svg
    viewBox="0 0 20 20"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {path}
  </svg>
);

export const IconDrag = ({ size = 16 }: P) =>
  svg(
    size,
    <g fill="currentColor" stroke="none">
      <circle cx="7" cy="5" r="1.4" />
      <circle cx="13" cy="5" r="1.4" />
      <circle cx="7" cy="10" r="1.4" />
      <circle cx="13" cy="10" r="1.4" />
      <circle cx="7" cy="15" r="1.4" />
      <circle cx="13" cy="15" r="1.4" />
    </g>,
  );
export const IconEye = ({ size = 16 }: P) =>
  svg(
    size,
    <>
      <path d="M1.8 10S4.8 4.5 10 4.5 18.2 10 18.2 10 15.2 15.5 10 15.5 1.8 10 1.8 10Z" />
      <circle cx="10" cy="10" r="2.5" />
    </>,
  );
export const IconEyeOff = ({ size = 16 }: P) =>
  svg(
    size,
    <>
      <path d="M8 4.8A8 8 0 0 1 10 4.5c5.2 0 8.2 5.5 8.2 5.5a14 14 0 0 1-2.3 3M5.3 6.2C3 7.7 1.8 10 1.8 10S4.8 15.5 10 15.5c1.6 0 3-.5 4.1-1.2" />
      <path d="M8.2 8.3a2.5 2.5 0 0 0 3.5 3.5M3 3l14 14" />
    </>,
  );
export const IconChevron = ({ size = 16, up }: P & { up?: boolean }) =>
  svg(size, <path d={up ? "M5 12.5 10 7.5l5 5" : "M5 7.5l5 5 5-5"} />);
export const IconArchive = ({ size = 16 }: P) =>
  svg(
    size,
    <>
      <rect x="2.5" y="3.5" width="15" height="4" rx="1" />
      <path d="M4 7.5v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-8M8 11h4" />
    </>,
  );
export const IconTrash = ({ size = 16 }: P) =>
  svg(
    size,
    <path d="M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M5 5.5l.8 10.6a1 1 0 0 0 1 .9h6.4a1 1 0 0 0 1-.9L15 5.5" />,
  );
export const IconHelp = ({ size = 16 }: P) =>
  svg(
    size,
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M7.8 7.8a2.3 2.3 0 0 1 4.4.9c0 1.5-2.2 1.9-2.2 3.1" />
      <circle cx="10" cy="14.3" r=".6" fill="currentColor" />
    </>,
  );
export const IconPlus = ({ size = 16 }: P) => svg(size, <path d="M10 4v12M4 10h12" />);
