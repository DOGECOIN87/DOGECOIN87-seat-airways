/**
 * The logbook, as the operator's page sees it.
 *
 * The same shape as `useDirectory`: one place that knows whether this browser
 * holds a session, what the server said, and which of the things that can go
 * wrong has — so the component is a view of that rather than a pile of
 * fetches.
 *
 * Two things here are not in the directory's version, and both come from the
 * route being hidden:
 *
 *   · `mine` is three-valued. Null is "the server has not been asked yet",
 *     false is "this wallet has no logbook", true is "here it is". The
 *     component draws nothing at all for the first two, which is what keeps a
 *     stranger who guessed the URL from learning anything — including from a
 *     flicker of something before it disappears.
 *
 *   · Nothing is fetched unless the page is actually open. Every other panel
 *     loads when it is on screen; this one is on screen only when somebody
 *     typed the fragment, and a request going out on every page view would be
 *     the one thing in the network tab that says the route exists.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DirectoryUnreachable, SessionExpired,
  signIn as openSession, storedSession,
  type Session,
} from './networkingApi';
import {
  amendEntry, logEntry, openLogbook, strikeEntry,
  type LogDraft, type LogEntry,
} from './logbookApi';

export interface LogbookState {
  /** Null until the server has been asked. False when this wallet has none. */
  mine: boolean | null;
  session: Session | null;
  /** Newest first, as the server keeps them. */
  entries: LogEntry[];
  loading: boolean;
  signingIn: boolean;
  saving: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  add: (draft: LogDraft) => Promise<boolean>;
  amend: (id: string, patch: Partial<LogEntry>) => Promise<boolean>;
  strike: (id: string) => Promise<void>;
  reload: () => Promise<void>;
  dismiss: () => void;
}

function reason(e: unknown): string {
  if (e instanceof DirectoryUnreachable || e instanceof SessionExpired) return e.message;
  const message = e instanceof Error ? e.message : String(e);
  // A refused signing prompt is a choice, not a failure worth shouting about.
  return /reject|denied|cancel/i.test(message) ? '' : message;
}

export function useLogbook(
  address: string | null,
  sign: (message: string) => Promise<string>,
  active: boolean,
): LogbookState {
  const [session, setSession] = useState<Session | null>(() => storedSession(address));
  const [mine, setMine] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* There is no "still mounted?" ref here, and that is deliberate.
  
     The usual pattern — a ref set false on unmount, checked after every await
     — was written for a React that warned about setting state on an unmounted
     component. React 18 dropped that warning because the update is simply
     discarded, and the guard turned out to cost more than it saved: this page
     renders inside a `<Suspense>` boundary, and when a boundary re-suspends
     React runs every effect's *cleanup* without unmounting anything. A
     signature approved in that window came back to a ref that said the
     component was gone, so the session was thrown away — leaving a token in
     storage, a panel stuck on "Check your wallet…", and no way out but a
     reload. Letting the update land is both simpler and correct.
  
     `mounted` below is not that flag. It exists only to tell the first run of
     the effect after it from a genuine change of wallet. */
  const seenAddress = useRef<string | null | undefined>(undefined);

  /* A session belongs to one wallet, so reconnecting as somebody else starts
     over. Only on an actual change, though: `storedSession` builds a fresh
     object every call, and setting one unconditionally made the read below
     fire again on every render that touched this effect. */
  useEffect(() => {
    if (seenAddress.current === address) return;
    const first = seenAddress.current === undefined;
    seenAddress.current = address;
    const found = storedSession(address);
    setSession(found);
    // Nothing to clear on the very first run, and clearing it would throw
    // away a read that a stored session had already started.
    if (!first) {
      setMine(null);
      setEntries([]);
      setError(null);
    }
  }, [address]);

  const read = useCallback(async (current: Session) => {
    setLoading(true);
    try {
      const found = await openLogbook(current);
      /* Null is the server declining to admit the route exists, which is the
         answer for everybody but one wallet. It is not an error and is never
         shown as one — `mine: false` and the component draws nothing. */
      setMine(found !== null);
      setEntries(found ?? []);
      setError(null);
    } catch (e) {
      if (e instanceof SessionExpired) setSession(null);
      setError(reason(e) || null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active || !session) return;
    void read(session);
  }, [active, session, read]);

  const signIn = useCallback(async () => {
    if (!address) return;
    setSigningIn(true);
    setError(null);
    try {
      const opened = await openSession(address, sign);
      setSession(opened);
    } catch (e) {
      const message = reason(e);
      if (message) setError(message);
    } finally {
      setSigningIn(false);
    }
  }, [address, sign]);

  const add = useCallback(async (draft: LogDraft) => {
    if (!session) return false;
    setSaving(true);
    setError(null);
    try {
      const written = await logEntry(session, draft);
      setEntries((current) => [written, ...current]);
      return true;
    } catch (e) {
      if (e instanceof SessionExpired) setSession(null);
      setError(reason(e) || null);
      return false;
    } finally {
      setSaving(false);
    }
  }, [session]);

  const amend = useCallback(async (id: string, patch: Partial<LogEntry>) => {
    if (!session) return false;
    setError(null);
    try {
      const updated = await amendEntry(session, id, patch);
      setEntries((current) => current.map((e) => (e.id === id ? updated : e)));
      return true;
    } catch (e) {
      if (e instanceof SessionExpired) setSession(null);
      setError(reason(e) || null);
      return false;
    }
  }, [session]);

  const strike = useCallback(async (id: string) => {
    if (!session) return;
    setError(null);
    /* Gone from the list first. This is one person deleting their own note on
       their own screen; waiting on a round trip to admit it happened makes a
       deliberate action feel broken. It comes back if the server disagreed. */
    const before = entries;
    setEntries((current) => current.filter((e) => e.id !== id));
    try {
      await strikeEntry(session, id);
    } catch (e) {
      if (e instanceof SessionExpired) setSession(null);
      setEntries(before);
      setError(reason(e) || null);
    }
  }, [session, entries]);

  const reload = useCallback(async () => {
    if (session) await read(session);
  }, [session, read]);

  const dismiss = useCallback(() => setError(null), []);

  return {
    mine, session, entries, loading, signingIn, saving, error,
    signIn, add, amend, strike, reload, dismiss,
  };
}
