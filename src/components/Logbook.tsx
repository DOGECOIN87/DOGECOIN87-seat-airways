/**
 * The logbook.
 *
 * One wallet's private notes, over the aircraft rather than in it: alpha
 * arrives in conversation — a room, an introduction, somebody's card — and is
 * lost the same way, remembered for a day and gone by the time it mattered.
 * This is where it gets written down.
 *
 * ── Hidden means hidden ───────────────────────────────────────────────────
 * Nothing on the site links here, no nav lists it, and the page is not built
 * into the bundle everybody downloads: `App.tsx` imports it lazily and mounts
 * it only when the URL carries the fragment. So the chunk is not even fetched
 * for a visitor who never types it.
 *
 * That is obscurity, and obscurity is not the security. The security is in
 * the Worker, which answers everybody but one wallet the same 404 a misspelt
 * path gets. This component's job is not to give that away: until the server
 * has confirmed, it draws a small neutral card that says nothing about what
 * it guards, and if the answer is no it draws nothing at all. A stranger who
 * guesses the fragment and connects a wallet learns exactly what a stranger
 * who never typed it learns.
 *
 * Which is also why the gate is a corner card rather than the full-screen
 * panel the logbook itself is: whoever ends up here by accident should get
 * their page back by closing one small thing, not be locked out of the site
 * by a door they have no business opening.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Manifest } from '../lib/manifest';
import { shortAddress } from '../lib/manifest';
import { sectionLabel } from '../lib/sectionAccess';
import {
  CONVICTIONS, LOG_STATUSES, STATUS_LABELS, parseTags,
  type LogEntry, type LogStatus,
} from '../lib/logbookApi';
import { useLogbook } from '../lib/useLogbook';
import { HANDS_OFF, WEATHERS, handsOff, type ManualControls } from '../lib/manualControls';
import { setFlight } from '../lib/flightApi';

interface LogbookProps {
  manifest: Manifest;
  address: string | null;
  sign: (message: string) => Promise<string>;
  /**
   * What the aeroplane is doing, and how to show a change at once.
   *
   * The change itself goes to the Worker from in here, because this is the
   * only place that holds the session it needs. `onControls` is the page
   * agreeing to draw it immediately rather than at the top of the next poll —
   * everybody else's page finds out the slow way, which is the right way
   * round: the person pressing the switch should not wait on their own poll.
   */
  controls: ManualControls;
  onControls: (next: ManualControls) => void;
  onClose: () => void;
}

const when = (iso: string) => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

/** The accent each rung of conviction carries, unrated through acting on it. */
const convictionTone = ['text-ui-faint', 'text-[#00A8D1]', 'text-[#8E76E8]', 'text-[#C2185B]'];

const statusTone: Record<LogStatus, string> = {
  open: 'border-[#00A8D1]/40 bg-[#EFFBFE] text-[#00708C]',
  acted: 'border-[#4CAF50]/40 bg-[#F1FAF1] text-[#2E7D32]',
  cold: 'border-ui-line bg-ui-bg text-ui-faint',
};

/**
 * A small, deliberately uninformative card.
 *
 * Every word here is chosen for what it does not say. No "admin", no
 * "logbook", nothing about notes — because this is what somebody who guessed
 * the fragment sees, and the whole point of the 404 behind it is that they
 * should come away no wiser.
 */
const Gate = ({ children, onClose }: { children: React.ReactNode; onClose: () => void }) => (
  <div className="fixed bottom-4 right-4 z-[60] w-[min(20rem,calc(100vw-2rem))]">
    <div className="ui-card px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-ui-deep">Identify</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 -mt-1 rounded-full px-2 py-0.5 text-[16px] leading-none text-ui-faint hover:text-ui-ink"
        >
          ×
        </button>
      </div>
      <div className="mt-3 text-[12px] leading-relaxed text-ui-soft">{children}</div>
    </div>
  </div>
);

/* ── The manual controls ──────────────────────────────────────────────────
   The aeroplane flies the market: pitch, bank, speed and altitude are all
   read off the chart, and that is the premise of the whole site. These are
   the switches that take hold of it anyway.

   They are the *aircraft's* switches and not this browser's. Throwing invert
   rolls the aeroplane on every open page — somebody sitting in 24C watches
   the ground come up over their window, somebody on the flight deck watches
   the artificial horizon go over — because an aeroplane only one person can
   see upside down is a screensaver.

   What they cannot touch is anything that matters. The altitude is still the
   market cap however far over the thing is rolled, the seats are still the
   holders, and no balance, address or message is reachable from here. The
   worst a switch can do is make the aeroplane look silly, which is the
   point. */

const Switch = ({ on, onClick, children, title }: {
  on: boolean; onClick: () => void; children: React.ReactNode; title?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={on}
    title={title}
    className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
      on ? 'border-ui-ink bg-ui-ink text-white' : 'border-ui-line text-ui-soft hover:text-ui-ink'
    }`}
  >
    {children}
  </button>
);

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-wrap items-center gap-2">
    <span className="w-[4.5rem] shrink-0 text-[10px] font-bold uppercase tracking-[0.18em] text-ui-faint">{label}</span>
    {children}
  </div>
);

const SPINS = [
  { rate: 0, label: 'Off' },
  { rate: 6, label: 'Slow' },
  { rate: 18, label: 'Fast' },
  { rate: -10, label: 'Reverse' },
];

const FLAPS = [
  { value: null, label: 'Auto' },
  { value: 0, label: 'Up' },
  { value: 0.5, label: 'Half' },
  { value: 1, label: 'Down' },
];

const Controls = ({ controls, onControls }: {
  controls: ManualControls;
  onControls: (next: Partial<ManualControls>) => void;
}) => {
  const set = (patch: Partial<ManualControls>) => onControls(patch);
  const inverted = ((controls.halfRolls % 2) + 2) % 2 === 1;

  return (
    <div className="space-y-2.5">
      <Row label="Attitude">
        <Switch on={inverted} onClick={() => set({ halfRolls: inverted ? controls.halfRolls - 1 : controls.halfRolls + 1 })}>
          {inverted ? 'Inverted' : 'Invert'}
        </Switch>
        {/* Two half-turns is a full one, and the scene eases the whole way
            round rather than to the nearest equivalent — so this rolls. */}
        <Switch on={false} onClick={() => set({ halfRolls: controls.halfRolls + 2 })}>Barrel roll</Switch>
        {controls.halfRolls !== 0 && (
          <Switch on={false} onClick={() => set({ halfRolls: 0 })}>Wings level</Switch>
        )}
      </Row>

      <Row label="Camera">
        {SPINS.map((s) => (
          <Switch key={s.label} on={controls.spin === s.rate} onClick={() => set({ spin: s.rate })}>
            {s.label}
          </Switch>
        ))}
      </Row>

      <Row label="Flaps">
        {FLAPS.map((f) => (
          <Switch key={f.label} on={controls.flaps === f.value} onClick={() => set({ flaps: f.value })}>
            {f.label}
          </Switch>
        ))}
      </Row>

      <Row label="Hour">
        <Switch on={controls.hour === null} onClick={() => set({ hour: null })}>Now</Switch>
        <input
          type="range"
          min={0}
          max={23}
          value={controls.hour ?? new Date().getHours()}
          onChange={(e) => set({ hour: Number(e.target.value) })}
          aria-label="Hour of day"
          className="h-1 w-40 cursor-pointer accent-[#8E76E8]"
        />
        <span className="w-12 text-[11px] tabular-nums text-ui-soft">
          {controls.hour === null ? 'live' : `${String(controls.hour).padStart(2, '0')}:00`}
        </span>
      </Row>

      <Row label="Weather">
        <Switch on={controls.weather === null} onClick={() => set({ weather: null })}>Live</Switch>
        {WEATHERS.map((w) => (
          <Switch key={w} on={controls.weather === w} onClick={() => set({ weather: w })}>
            {w}
          </Switch>
        ))}
      </Row>

      {!handsOff(controls) && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => onControls(HANDS_OFF)}
            className="text-[10px] font-bold uppercase tracking-[0.16em] text-ui-faint hover:text-ui-ink"
          >
            Hands off — give it back to the market
          </button>
        </div>
      )}
    </div>
  );
};

const Logbook = ({ manifest, address, sign, controls, onControls, onClose }: LogbookProps) => {
  const book = useLogbook(address, sign, true);
  /** Why the aeroplane would not do as it was told, if it would not. */
  const [refused, setRefused] = useState<string | null>(null);
  /* Collapsed to the switches alone, so the aeroplane is visible while it is
     being flown. The fragment stays in the URL and the session stays open:
     this is the same page with its own panel folded down. */
  const [flying, setFlying] = useState(false);

  const [body, setBody] = useState('');
  const [source, setSource] = useState('');
  const [tags, setTags] = useState('');
  const [conviction, setConviction] = useState(1);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<LogStatus | 'all'>('all');
  const [tag, setTag] = useState<string | null>(null);

  const open = book.mine === true;

  /**
   * Move a switch.
   *
   * Shown here first and sent second, in that order on purpose: the person
   * pressing it should not wait on a round trip to see their own aeroplane
   * roll. Everybody else finds out at the top of their next poll, which is
   * the right way round.
   *
   * A refusal puts it back. Leaving the panel showing `Inverted` over an
   * aeroplane that is the right way up would be the switch lying about the
   * aircraft, which is worse than the aircraft not rolling.
   */
  const fly = async (patch: Partial<ManualControls>) => {
    if (!book.session) return;
    const before = controls;
    const next = { ...controls, ...patch };
    onControls(next);
    setRefused(null);
    try {
      const landed = await setFlight(book.session, next);
      // What the Worker stored, which may have clamped something.
      onControls(landed);
    } catch (e) {
      onControls(before);
      setRefused(e instanceof Error ? e.message : 'The aeroplane would not take that.');
    }
  };

  /* The page behind does not scroll while this is over it, and Escape closes
     it — the two things a full-screen panel owes whoever opened it. */
  useEffect(() => {
    // Folded down to the switches, the page behind is the point of the
    // exercise — so it scrolls, and only the full panel locks it.
    if (!open || flying) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', escape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', escape);
    };
  }, [open, flying, onClose]);

  /* Who said it, if the source happens to be somebody aboard.

     Resolved against the seat map the page already holds rather than asked
     for: a note whose source is a wallet reads as a seat and a section, which
     is the difference between "Hn1i…nELo said this" and "3B, First Class". */
  const seats = useMemo(() => {
    const bySeat = new Map<string, string>();
    for (const entry of manifest.entries) {
      bySeat.set(entry.address, `${entry.seat.id} · ${sectionLabel(entry.seat.zone)} · #${entry.rank}`);
    }
    return bySeat;
  }, [manifest]);

  /** Every tag in the book, commonest first, for the filter row. */
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of book.entries) {
      for (const t of entry.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  }, [book.entries]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return book.entries.filter((entry) => {
      if (status !== 'all' && entry.status !== status) return false;
      if (tag && !entry.tags.includes(tag)) return false;
      if (!needle) return true;
      return `${entry.body} ${entry.source} ${entry.tags.join(' ')}`.toLowerCase().includes(needle);
    });
  }, [book.entries, query, status, tag]);

  /* Nothing. Not an error, not a message, not a shape where something would
     be — this is the answer for every wallet but one, and it has to look
     exactly like never having typed the fragment. */
  if (book.mine === false) return null;

  if (!book.session) {
    return (
      <Gate onClose={onClose}>
        {!address ? (
          <p>Connect a wallet to continue.</p>
        ) : (
          <>
            <p className="break-all">{shortAddress(address)}</p>
            <button
              type="button"
              onClick={() => void book.signIn()}
              disabled={book.signingIn}
              className="mt-3 w-full rounded-lg bg-ui-ink px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white disabled:opacity-50"
            >
              {book.signingIn ? 'Check your wallet…' : 'Sign'}
            </button>
            {book.error && <p className="mt-2 text-[11px] text-[#C2185B]">{book.error}</p>}
          </>
        )}
      </Gate>
    );
  }

  /* Asked, not yet answered — or asked and never answered at all.

     Still says nothing about what the answer might be: a network failure is a
     network failure whoever is asking, and the one answer this must never
     give away is the one it never reaches here. Saying "Checking." forever
     after a request that came back refused would be the panel lying about
     what it is doing. */
  if (book.mine === null) {
    return <Gate onClose={onClose}><p>{book.error ?? 'Checking.'}</p></Gate>;
  }

  const submit = async () => {
    if (!body.trim()) return;
    const ok = await book.add({
      body,
      source: source.trim(),
      tags: parseTags(tags),
      conviction,
    });
    if (ok) {
      setBody('');
      setSource('');
      setTags('');
      setConviction(1);
    }
  };

  const counts = {
    open: book.entries.filter((e) => e.status === 'open').length,
    acted: book.entries.filter((e) => e.status === 'acted').length,
  };

  /* Folded down: the switches over the page, and the page free to scroll
     under them. This is the mode the aeroplane is actually flown in — the
     full panel covers the very thing the switches are moving. */
  if (flying) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-[70] border-t border-ui-line bg-ui-surface/95 backdrop-blur">
        <div className="mx-auto w-full max-w-4xl px-4 py-3.5 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-ui-deep">Manual controls</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFlying(false)}
                className="rounded-lg border border-ui-line px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-ui-soft"
              >
                Logbook
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-ui-ink px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-white"
              >
                Close
              </button>
            </div>
          </div>
          <div className="mt-3">
            <Controls controls={controls} onControls={(patch) => void fly(patch)} />
            {refused && <p className="mt-2 text-[11px] text-[#C2185B]">{refused}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-ui-bg" role="dialog" aria-label="Logbook">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-10">

        {/* ── Header ── */}
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-ui-deep">Logbook</p>
            <h1 className="sa-display sa-display--2 mt-2">Things worth remembering</h1>
            <p className="mt-2 text-[12px] text-ui-soft">
              {book.entries.length} logged · {counts.open} open · {counts.acted} acted on
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void book.reload()}
              disabled={book.loading}
              className="rounded-lg border border-ui-line px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-ui-soft disabled:opacity-50"
            >
              {book.loading ? 'Reading…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={() => {
                setFlying(true);
                // Up to the hero, which is the thing the switches move.
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="rounded-lg border border-ui-line px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-ui-soft"
            >
              Fly it
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-ui-ink px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white"
            >
              Close
            </button>
          </div>
        </header>

        {book.error && (
          <div className="mt-5 flex items-start justify-between gap-3 rounded-xl border border-[#C2185B]/30 bg-[#FFF1F5] px-4 py-3 text-[12px] text-[#8A1140]">
            <p>{book.error}</p>
            <button type="button" onClick={book.dismiss} aria-label="Dismiss" className="text-[15px] leading-none">×</button>
          </div>
        )}

        {/* ── The switches ──
            Above the composer, because they are the thing you came back for
            when you were not writing anything down. "Fly it" in the header
            folds everything else away so the aeroplane is visible. */}
        <section className="ui-card mt-6">
          <div className="flex items-center justify-between gap-3 border-b border-ui-line px-5 py-3 sm:px-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-ui-deep">Manual controls</p>
            <p className="text-[11px] text-ui-faint">
              {handsOff(controls) ? 'Flying the market' : 'Flown by hand'}
            </p>
          </div>
          <div className="px-5 py-4 sm:px-6">
            <Controls controls={controls} onControls={(patch) => void fly(patch)} />
            {refused && <p className="mt-3 text-[11px] text-[#C2185B]">{refused}</p>}
          </div>
        </section>

        {/* ── Write one down ──
            First on the page and never behind a click. A note that takes two
            taps to start is a note taken after the conversation, which is a
            note half of. */}
        <section className="ui-card ui-card--accent mt-6">
          <div className="px-5 py-5 sm:px-6">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="What was said, and what it might mean."
              className="w-full resize-y rounded-lg border border-ui-line bg-white px-3 py-2.5 text-[13px] leading-relaxed text-ui-ink outline-none focus:border-[#8E76E8]"
            />

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ui-faint">Source</span>
                <input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  maxLength={120}
                  placeholder="A wallet, a handle, a room"
                  className="mt-1 w-full rounded-lg border border-ui-line bg-white px-3 py-2 text-[12px] text-ui-ink outline-none focus:border-[#8E76E8]"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ui-faint">Tags</span>
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="listing, partner, cex"
                  className="mt-1 w-full rounded-lg border border-ui-line bg-white px-3 py-2 text-[12px] text-ui-ink outline-none focus:border-[#8E76E8]"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ui-faint">Conviction</span>
                {CONVICTIONS.map((rung) => (
                  <button
                    key={rung.value}
                    type="button"
                    onClick={() => setConviction(rung.value)}
                    aria-pressed={conviction === rung.value}
                    className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                      conviction === rung.value
                        ? 'border-ui-ink bg-ui-ink text-white'
                        : 'border-ui-line text-ui-soft'
                    }`}
                  >
                    {rung.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={book.saving || !body.trim()}
                className="rounded-lg bg-ui-ink px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white disabled:opacity-40"
              >
                {book.saving ? 'Logging…' : 'Log it'}
              </button>
            </div>
          </div>
        </section>

        {/* ── Find one again ── */}
        {book.entries.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="w-full max-w-xs rounded-lg border border-ui-line bg-white px-3 py-2 text-[12px] text-ui-ink outline-none focus:border-[#8E76E8]"
            />
            {(['all', ...LOG_STATUSES] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatus(key)}
                aria-pressed={status === key}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                  status === key ? 'border-ui-ink bg-ui-ink text-white' : 'border-ui-line text-ui-soft'
                }`}
              >
                {key === 'all' ? 'All' : STATUS_LABELS[key]}
              </button>
            ))}
            {allTags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTag(tag === t ? null : t)}
                aria-pressed={tag === t}
                className={`rounded-full border px-2.5 py-1 text-[11px] ${
                  tag === t ? 'border-[#8E76E8] bg-[#F6F3FF] text-[#5B3FD1]' : 'border-ui-line text-ui-faint'
                }`}
              >
                #{t}
              </button>
            ))}
          </div>
        )}

        {/* ── The log ── */}
        <div className="mt-5 space-y-3 pb-12">
          {shown.length === 0 ? (
            <p className="rounded-xl border border-dashed border-ui-line px-4 py-8 text-center text-[12px] text-ui-faint">
              {book.entries.length === 0
                ? 'Nothing logged yet. The first one is usually the one you would have forgotten.'
                : 'Nothing matches that.'}
            </p>
          ) : shown.map((entry) => (
            <Entry
              key={entry.id}
              entry={entry}
              seat={seats.get(entry.source)}
              onStatus={(next) => void book.amend(entry.id, { status: next })}
              onConviction={(next) => void book.amend(entry.id, { conviction: next })}
              onStrike={() => void book.strike(entry.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

interface EntryProps {
  entry: LogEntry;
  /** Where the source sits, when the source is somebody aboard. */
  seat: string | undefined;
  onStatus: (next: LogStatus) => void;
  onConviction: (next: number) => void;
  onStrike: () => void;
}

const Entry = ({ entry, seat, onStatus, onConviction, onStrike }: EntryProps) => {
  const [confirming, setConfirming] = useState(false);

  return (
    <article className={`ui-card px-4 py-4 sm:px-5 ${entry.status === 'cold' ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${statusTone[entry.status]}`}>
          {STATUS_LABELS[entry.status]}
        </span>
        <span className={`text-[11px] font-semibold ${convictionTone[entry.conviction] ?? 'text-ui-faint'}`}>
          {CONVICTIONS[entry.conviction]?.label ?? 'Unrated'}
        </span>
        <span className="ml-auto text-[11px] text-ui-faint">{when(entry.createdAt)}</span>
      </div>

      <p className="mt-2.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ui-ink">{entry.body}</p>

      {entry.source && (
        <p className="mt-2 text-[11px] text-ui-soft">
          <span className="text-ui-faint">From </span>
          {seat ? (
            <>
              <span className="font-semibold">{seat}</span>
              <span className="text-ui-faint"> · {shortAddress(entry.source)}</span>
            </>
          ) : (
            <span className="break-all font-semibold">{entry.source}</span>
          )}
        </p>
      )}

      {entry.tags.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-1.5">
          {entry.tags.map((t) => (
            <span key={t} className="rounded-full border border-ui-line px-2 py-0.5 text-[10px] text-ui-faint">#{t}</span>
          ))}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-ui-line pt-3">
        {LOG_STATUSES.filter((s) => s !== entry.status).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onStatus(s)}
            className="rounded-full border border-ui-line px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ui-soft hover:text-ui-ink"
          >
            {s === 'open' ? 'Reopen' : s === 'acted' ? 'Acted on' : 'Cold'}
          </button>
        ))}

        <span className="mx-1 text-ui-line">|</span>
        {CONVICTIONS.filter((c) => c.value !== entry.conviction).map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => onConviction(c.value)}
            title={`Mark ${c.label.toLowerCase()}`}
            className="rounded-full border border-ui-line px-2 py-1 text-[10px] text-ui-faint hover:text-ui-ink"
          >
            {c.value}
          </button>
        ))}

        {confirming ? (
          <span className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={onStrike}
              className="rounded-full bg-[#C2185B] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-[10px] uppercase tracking-[0.12em] text-ui-faint"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="ml-auto text-[10px] uppercase tracking-[0.12em] text-ui-faint hover:text-[#C2185B]"
          >
            Strike out
          </button>
        )}
      </div>
    </article>
  );
};

export default Logbook;
