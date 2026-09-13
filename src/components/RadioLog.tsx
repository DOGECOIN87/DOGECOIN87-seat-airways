import { useEffect, useRef } from 'react';

/**
 * Cabin radio — the PA and the crew, in the order it was said.
 *
 * Newest at the top. The panel takes the height its column has left and the
 * list scrolls inside it, so the log never grows the page and never sits as a
 * stub beside a taller neighbour. It is a live region so an announcement that
 * matters (masks, brace) reaches a screen reader as well as the eye, but it is
 * polite rather than assertive: the log is atmosphere, and it should never
 * interrupt someone mid-sentence.
 */

export interface LogEntry {
  id: number;
  at: string;
  text: string;
  tone: 'pa' | 'alert' | 'plain';
}

/* Two accents used to separate a PA announcement from an alert. With one
   blue in the palette the separation is weight, not hue: an alert is the
   ink at full strength, a PA is the blue, everything else is grey. That
   still reads at a glance, and it survives being looked at by somebody who
   does not separate colours at all. */
const TONE: Record<LogEntry['tone'], string> = {
  pa: 'text-ui-deep',
  alert: 'font-semibold text-ui-ink',
  plain: 'text-ui-soft',
};

const RadioLog = ({ entries }: { entries: readonly LogEntry[] }) => {
  const listRef = useRef<HTMLUListElement>(null);

  // A fresh line arrives at the top; keep the panel scrolled there so it is
  // the one you read, even if someone has nudged the list.
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [entries]);

  return (
    <div className="flex h-full flex-col ui-card">
      <header className="flex flex-none items-center gap-2.5 ui-rule-b px-4 py-3">
        <span aria-hidden className="sa-pulse-glow h-1.5 w-1.5 bg-ui-blue" style={{ borderRadius: '9999px' }} />
        <h3 className="font-heading text-base text-ui-ink">Cabin radio</h3>
        <span className="ml-auto text-[10px] uppercase tracking-[0.18em] text-ui-faint">Live</span>
      </header>

      <ul
        ref={listRef}
        aria-live="polite"
        aria-relevant="additions"
        className="min-h-0 flex-1 overflow-y-auto px-4 [scrollbar-width:thin]"
      >
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex items-baseline gap-3 ui-rule-b py-2.5 text-[13px] leading-relaxed last:border-b-0"
          >
            <time className="flex-none tabular-nums text-[11px] text-ui-faint">{entry.at}</time>
            <span className={TONE[entry.tone]}>{entry.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default RadioLog;
