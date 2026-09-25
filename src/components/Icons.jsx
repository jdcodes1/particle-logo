const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export const ReplayIcon = () => (
  <svg {...base}><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" /><path d="M2.5 2.5v2.8h2.8" /></svg>
);
export const ExpandIcon = () => (
  <svg {...base}><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" /></svg>
);
export const UploadIcon = () => (
  <svg {...base}><path d="M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10" /></svg>
);
export const DownloadIcon = () => (
  <svg {...base}><path d="M8 2.5v8M5 7.5l3 3 3-3M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10" /></svg>
);
export const ShuffleIcon = () => (
  <svg {...base}><path d="M2 4.5h2.5c3 0 4 7 7 7H14M2 11.5h2.5c1.2 0 2-1 2.7-2.3M9 6.5c.7-1.2 1.5-2 2.5-2H14M12 2.5l2 2-2 2M12 9.5l2 2-2 2" /></svg>
);
export const ResetIcon = () => (
  <svg {...base}><path d="M3 3v3.5h3.5" /><path d="M3.3 6.5A5.5 5.5 0 1 1 2.5 9" /></svg>
);
export const CloseIcon = () => (
  <svg {...base}><path d="M4 4l8 8M12 4l-8 8" /></svg>
);
export const CodeIcon = () => (
  <svg {...base}><path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" /></svg>
);
