import { useEffect, useRef } from 'react';

/**
 * Cabin radio — the PA and the crew, in the order it was said.
 *
 * Newest at the top, capped so the panel never grows the page. The list is a
 * live region so an announcement that matters (masks, brace) reaches a screen
 * reader as well as the eye, but it is polite rather than assertive: the log
 * is atmosphere, and it should never interrupt someone mid-sentence.
 */

export interface LogEntry {
  id: number;
  at: string;
  text: string;
  tone: 'pa' | 'alert' | 'plain';
}

const TONE: Record<LogEntry['tone'], string> = {
  pa: 'text-seat-cyan',
  alert: 'text-seat-amber',
  plain: 'text-blue-100/75',
};

const RadioLog = ({ entries }: { entries: readonly LogEntry[] }) => {
  const listRef = useRef<HTMLUListElement>(null);

  // A fresh line arrives at the top; keep the panel scrolled there so it is
  // the one you read, even if someone has nudged the list.
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [entries]);

  return (
    <div className="border border-white/10 bg-[#141821]/70 backdrop-blur-sm">
      <header className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3">
        <span aria-hidden className="sa-pulse-glow h-1.5 w-1.5 bg-seat-amber" style={{ borderRadius: '9999px' }} />
        <h3 className="font-heading text-base text-white">Cabin radio</h3>
        <span className="ml-auto text-[10px] uppercase tracking-[0.18em] text-blue-100/35">Live</span>
      </header>

      <ul
        ref={listRef}
        aria-live="polite"
        aria-relevant="additions"
        className="max-h-[19rem] overflow-y-auto px-4 [scrollbar-width:thin]"
      >
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex items-baseline gap-3 border-b border-white/5 py-2.5 text-[13px] leading-relaxed last:border-b-0"
          >
            <time className="flex-none tabular-nums text-[11px] text-blue-100/35">{entry.at}</time>
            <span className={TONE[entry.tone]}>{entry.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default RadioLog;
