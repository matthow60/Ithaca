// Odyssey-themed line icons. Inline SVG, no dependencies.
// They draw with `currentColor`, so set the color from CSS.

function Icon({ size = 18, title, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      {...rest}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

// Ionic column: brand mark
export const ColumnIcon = (p) => (
  <Icon {...p}>
    <path d="M3 3.5h18" />
    <circle cx="6" cy="7" r="1.9" />
    <circle cx="18" cy="7" r="1.9" />
    <path d="M7.9 7h8.2" />
    <path d="M7.5 9.5V20M10.5 9.5V20M13.5 9.5V20M16.5 9.5V20" />
    <path d="M5 20.5h14" />
  </Icon>
);

// Storm cloud with lightning: crash detected
export const StormIcon = (p) => (
  <Icon {...p}>
    <path d="M7 16a4 4 0 0 1-.7-7.94A5.5 5.5 0 0 1 16.9 7.1 3.5 3.5 0 0 1 17.5 14" />
    <path d="M12.5 11.5 10 16h3.2l-2.2 5" />
  </Icon>
);

// Compass: reproducing the user's route
export const CompassIcon = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.8 8.2-2.4 5.2-5.2 2.4 2.4-5.2z" />
    <path d="M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21" />
  </Icon>
);

// Athena's owl (wisdom): AI patching
export const OwlIcon = (p) => (
  <Icon {...p}>
    <path d="M5.5 3.5 8 6h8l2.5-2.5V13a6.5 6.5 0 0 1-13 0z" />
    <circle cx="9.3" cy="10.2" r="1.9" />
    <circle cx="14.7" cy="10.2" r="1.9" />
    <path d="m11.2 13.4.8 1.3.8-1.3" />
  </Icon>
);

// Greek ship with square sail: PR ready / safe harbour
export const ShipIcon = (p) => (
  <Icon {...p}>
    <path d="M12 3v12" />
    <path d="M7.5 4.5h9l-1 7h-7z" />
    <path d="M2.5 15h19c-.6 2.6-2.8 4.5-5.5 4.5H8c-2.7 0-4.9-1.9-5.5-4.5z" />
    <path d="M21.5 15c.6-1.2.4-2.6-.6-3.3" />
  </Icon>
);

// Breaking wave: lost at sea (fix failed / not reproducible)
export const WaveIcon = (p) => (
  <Icon {...p}>
    <path d="M2 18c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5" />
    <path d="M4 13.5C4.8 8 9 4.5 13.5 5c3.5.4 5.8 3.2 5 6.5-1.2-1.8-3.5-2.4-5.2-1.2-1.4 1-1.6 2.6-1 3.7" />
  </Icon>
);

// Pointer: click action
export const PointerIcon = (p) => (
  <Icon {...p}>
    <path d="m5 3.5 13 6.2-5.6 1.8-2 5.8z" />
    <path d="m12.4 11.5 5.1 5.1" />
  </Icon>
);

// Quill: input action
export const QuillIcon = (p) => (
  <Icon {...p}>
    <path d="M20 3.5C12.5 4.5 8 9 7 16.5c7.5-1 12-5.5 13-13z" />
    <path d="M4 20.5 12 12.5" />
  </Icon>
);

// Sail: navigate action / the user's journey
export const SailIcon = (p) => (
  <Icon {...p}>
    <path d="M12 3v14" />
    <path d="M12 4.5c3.5 2.5 6 6.5 6.5 10.5H12" />
    <path d="M3.5 18.5h17l-1.8 2.5H5.3z" />
  </Icon>
);

// Labyrinth: stack trace
export const LabyrinthIcon = (p) => (
  <Icon {...p}>
    <path d="M12 3.5H3.5v17h17v-17H15" />
    <path d="M12 7H7v10h10V7h-2" />
    <path d="M12 10.5h-1.5v3h3v-3" />
  </Icon>
);

// Scroll: the written incident summary
export const ScrollIcon = (p) => (
  <Icon {...p}>
    <path d="M7 4h11a2 2 0 0 1 2 2v1h-3" />
    <path d="M17 6v12a2.5 2.5 0 0 1-2.5 2.5H5.5A2.5 2.5 0 0 1 3 18v-1h11.5" />
    <path d="M7 4a2 2 0 0 0-2 2v11" />
    <path d="M9 9h5M9 12.5h5" />
  </Icon>
);
