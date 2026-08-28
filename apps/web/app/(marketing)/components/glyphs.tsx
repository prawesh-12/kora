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

export function PlayGlyph() {
  return (
    <svg className="pill__icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M5 3 L17 10 L5 17 Z" fill="currentColor" />
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

/** One pipeline, three gates. */
export function ActGlyph() {
  return (
    <Svg size={40}>
      <path d="M20 5 V35" {...stroke} />
      <rect x="12" y="5" width="16" height="8" {...stroke} />
      <rect x="12" y="16" width="16" height="8" {...stroke} />
      <rect x="12" y="27" width="16" height="8" {...stroke} />
    </Svg>
  );
}

/** Read the entity back, compare it. */
export function VerifyGlyph() {
  return (
    <Svg size={40}>
      <circle cx="20" cy="20" r="15" {...stroke} />
      <path d="M12 20 L18 26 L28 14" {...stroke} />
    </Svg>
  );
}

/** Deterministic checks, scored against the business system. */
export function EvaluateGlyph() {
  return (
    <Svg size={40}>
      <path d="M5 6 H35 M5 6 V34 M5 34 H35" {...stroke} />
      <path d="M12 13 H28 M12 20 H28 M12 27 H22" {...stroke} />
    </Svg>
  );
}

/** Two versions, one delta. */
export function ImproveGlyph() {
  return (
    <Svg size={40}>
      <path d="M7 35 V22 H14 V35 Z M26 35 V10 H33 V35 Z" {...stroke} />
      <path d="M18 22 L22 18 L22 26 Z" fill="currentColor" stroke="none" />
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
