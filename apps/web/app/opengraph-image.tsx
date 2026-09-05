import { ImageResponse } from 'next/og';

export const alt = 'Kora — money operations, proven in Stripe';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// TODO(plan): brand identity is a designer task. Wordmark and signal rule only.
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#FCFCFD',
        color: '#111418',
        padding: 80,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>Kora</div>
        <div style={{ width: 96, height: 6, background: '#3B4CCA' }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900 }}>
        <div style={{ fontSize: 64, fontWeight: 600, lineHeight: 1.1, letterSpacing: -1.5 }}>
          Refunds, cancellations and plan changes, read back and confirmed.
        </div>
        <div style={{ fontSize: 28, color: '#5B6470' }}>
          It never says an action succeeded until it has read it back from Stripe.
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          borderTop: '1px solid #E4E7EC',
          paddingTop: 24,
          fontSize: 24,
          color: '#5B6470',
        }}
      >
        Money operations for subscription businesses
      </div>
    </div>,
    size,
  );
}
