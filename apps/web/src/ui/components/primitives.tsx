import type { ReactNode } from 'react';
import type { Tone } from '../presenters/labels';

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge tone-${tone}`} title={title}>
      {children}
    </span>
  );
}

/** Small status glyph. Shape differs per tone so state is not conveyed by colour alone. */
export function StatusIcon({ tone, label }: { tone: Tone; label?: string }) {
  const common = { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': label ? undefined : true, role: label ? 'img' : undefined, 'aria-label': label } as const;
  switch (tone) {
    case 'success':
      return (
        <svg {...common} className={`status-icon tone-${tone}`}>
          <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.18" />
          <path d="M4.5 8.2l2.3 2.3 4.7-4.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'danger':
      return (
        <svg {...common} className={`status-icon tone-${tone}`}>
          <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.18" />
          <path d="M5.5 5.5l5 5m0-5l-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'waiting':
      return (
        <svg {...common} className={`status-icon tone-${tone}`}>
          <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.18" />
          <rect x="5.2" y="4.8" width="1.9" height="6.4" rx="0.8" fill="currentColor" />
          <rect x="8.9" y="4.8" width="1.9" height="6.4" rx="0.8" fill="currentColor" />
        </svg>
      );
    case 'active':
      return (
        <svg {...common} className={`status-icon tone-${tone} spin`}>
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
          <path d="M8 2a6 6 0 016 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'muted':
      return (
        <svg {...common} className={`status-icon tone-${tone}`}>
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.2 2" />
        </svg>
      );
    default:
      return (
        <svg {...common} className={`status-icon tone-${tone}`}>
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
  }
}

export function Section({ title, aside, children, id }: { title: ReactNode; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="panel-section" id={id}>
      <header className="panel-section-head">
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function KeyValue({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k} className="kv-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <code className="mono">{children}</code>;
}

export function InlineError({ children }: { children: ReactNode }) {
  return (
    <p className="inline-error" role="alert">
      {children}
    </p>
  );
}

export function Pending({ children }: { children: ReactNode }) {
  return (
    <p className="pending-note" role="status">
      <StatusIcon tone="active" />
      <span>{children}</span>
    </p>
  );
}
