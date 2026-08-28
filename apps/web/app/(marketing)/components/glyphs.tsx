/**
 * Hand-authored geometry. No icon library is used on this route: every mark
 * here is a flat shape drawn to mean one specific thing, and a general-purpose
 * icon set would only be filling space.
 *
 * All of these are decorative. The element that owns them carries the label.
 */

const stroke = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'square' as const,
  strokeLinejoin: 'miter' as const,
};

function Svg({
  size,
  box = 40,
  children,
}: {
  size: number;
  box?: number;
  children: React.ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${box} ${box}`}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/* -- controls ---------------------------------------------------------- */

export function ArrowDownGlyph() {
  return (
    <svg className="pill__icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M10 3 V16 M4 10.5 L10 16.5 L16 10.5" {...stroke} />
    </svg>
  );
}

export function CaretGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M2 4.5 L6 8.5 L10 4.5" {...stroke} strokeWidth={1.5} />
    </svg>
  );
}

export function ArrowUpRightGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <path d="M4 10 L10 4 M4.5 4 H10 V9.5" {...stroke} strokeWidth={1.5} />
    </svg>
  );
}

export function ChevronGlyph() {
  return (
    <svg
      className="acc__chev"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 9 L12 16 L19 9" {...stroke} />
    </svg>
  );
}

/* -- 3.5 problem cards, 28px inside a 56px amber tile ------------------ */

/** An empty result. Brackets with nothing between them. */
export function EmptyResultGlyph() {
  return (
    <Svg size={28} box={28}>
      <path d="M10 4 H4 V24 H10 M18 4 H24 V24 H18" {...stroke} />
    </Svg>
  );
}

/** A policy that lives in prose. A speech bubble. */
export function BubbleGlyph() {
  return (
    <Svg size={28} box={28}>
      <path d="M3 4 H25 V19 H12 L6 25 V19 H3 Z" {...stroke} />
    </Svg>
  );
}

/** The same write, twice. Two offset squares. */
export function DuplicateGlyph() {
  return (
    <Svg size={28} box={28}>
      <path d="M3 3 H18 V18 H3 Z M10 10 H25 V25 H10 Z" {...stroke} />
    </Svg>
  );
}

/** A run with a hole in it. Three rows, the middle one broken. */
export function BrokenLogGlyph() {
  return (
    <Svg size={28} box={28}>
      <path d="M3 6 H25 M3 14 H10 M18 14 H25 M3 22 H25" {...stroke} />
    </Svg>
  );
}

/* -- 3.7 pillars, 40px stroked outline --------------------------------- */

/** Act. One funnel, one way through. */
export function ActGlyph() {
  return (
    <Svg size={40}>
      <path d="M5 7 H35 L23 21 V34 L17 30 V21 Z" {...stroke} />
    </Svg>
  );
}

/** Verify. A check that has to survive the brackets around it. */
export function VerifyGlyph() {
  return (
    <Svg size={40}>
      <path d="M14 6 H6 V34 H14 M26 6 H34 V34 H26" {...stroke} />
      <path d="M13 20 L18 25 L27 14" {...stroke} />
    </Svg>
  );
}

/** Evaluate. Measured against something, and the mark it earned. */
export function EvaluateGlyph() {
  return (
    <Svg size={40}>
      <path d="M4 30 H36 M10 30 V24 M17 30 V24 M24 30 V24 M31 30 V24" {...stroke} />
      <path d="M11 12 L16 17 L27 6" {...stroke} />
    </Svg>
  );
}

/** Improve. Two runs of the same thing, offset by the difference. */
export function ImproveGlyph() {
  return (
    <Svg size={40}>
      <path d="M6 34 V19 H17 V34 Z M23 27 V6 H34 V27 Z" {...stroke} />
    </Svg>
  );
}

/* -- fragments --------------------------------------------------------- */

/** The check used inside product fragments. Sits on a coloured ground. */
export function CheckGlyph({ size = 16, width = 2.5 }: { size?: number; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M3 8 L6.5 11.5 L13 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={width}
        strokeLinecap="square"
      />
    </svg>
  );
}
