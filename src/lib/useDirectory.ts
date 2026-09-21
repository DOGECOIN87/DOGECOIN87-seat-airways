/**
 * The directory, as the hub sees it.
 *
 * One place that knows whether this browser holds a session, what the server
 * says is in the directory, and which of the four things that can go wrong
 * has gone wrong — so the component below is a view of that rather than a
 * pile of fetches.
 *
 * Nothing loads until there is a session. The roster and the inbox are both
 * private, so there is nothing to show a visitor who has not signed in, and
 * asking for it anyway would only produce a 401 per page view.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DirectoryUnreachable, SessionExpired,
  fetchDirectory, fetchMessages, hasDirectory, saveProfile, sendMessage,
  signIn as openSession, signOut as closeSession, storedSession,
  type NetworkingMessage, type NetworkingProfile, type PublishedProfile, type Session,
} from './networkingApi';
import { ANNOUNCEMENT, zoneOfChannel } from './sectionAccess';
import type { ZoneKey } from '../content/cabin';

export interface DirectoryState {
  /** Whether this deployment has a directory service at all. */
  available: boolean;
  session: Session | null;
  /** Every published card, keyed by wallet. Empty until signed in. */
  profiles: Record<string, PublishedProfile>;
  inbox: NetworkingMessage[];
  sent: NetworkingMessage[];
  /** Conversations from the cabins behind you, which your seat lets you read. */
  overheard: NetworkingMessage[];
  /** Each cabin's own room, keyed by section. Only the ones you may read. */
  channels: Partial<Record<ZoneKey, NetworkingMessage[]>>;
  /** The PA, newest first. */
  announcements: NetworkingMessage[];
  loading: boolean;
  /** True while a signature is being waited on. */
  signingIn: boolean;
  /** True while a card or an introduction is in flight. */
  saving: boolean;
  error: string | null;
  notice: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  save: (profile: NetworkingProfile) => Promise<boolean>;
  send: (to: string, body: string) => Promise<boolean>;
  /**
   * Fetch the cabins behind you as well as your own.
   *
   * What the hub's listen button calls. The first load asks for one room
   * because that is what the hub draws; this is the moment somebody says
   * they want the rest.
   */
  hearAft: () => Promise<void>;
  dismiss: () => void;
}

/** What to tell somebody, from whatever was thrown. */
function reason(e: unknown): string {
  if (e instanceof DirectoryUnreachable || e instanceof SessionExpired) return e.message;
  const message = e instanceof Error ? e.message : String(e);
  // A refused signing prompt is a choice, not a failure worth shouting about.
  return /reject|denied|cancel/i.test(message) ? '' : message;
}

export function useDirectory(
  address: string | null,
  sign: (message: string) => Promise<string>,
): DirectoryState {
  const [session, setSession] = useState<Session | null>(() => storedSession(address));
  const [profiles, setProfiles] = useState<Record<string, PublishedProfile>>({});
  const [inbox, setInbox] = useState<NetworkingMessage[]>([]);
  const [sent, setSent] = useState<NetworkingMessage[]>([]);
  const [overheard, setOverheard] = useState<NetworkingMessage[]>([]);
  const [channels, setChannels] = useState<Partial<Record<ZoneKey, NetworkingMessage[]>>>({});
  const [announcements, setAnnouncements] = useState<NetworkingMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const live = useRef(true);

  /* Re-armed on mount, not only cleared on unmount. StrictMode mounts, tears
     down and remounts every effect in development, so a ref that is only ever
     set to false stays false for the rest of the page's life — and every
     state update after an await is then dropped, leaving the panel sitting on
     "Check your wallet…" while the request it is waiting for has long since
     come back. */
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  // A session belongs to one wallet. Reconnecting as somebody else starts over.
  useEffect(() => {
    setSession(storedSession(address));
    setProfiles({});
    setInbox([]);
    setSent([]);
    setOverheard([]);
    setChannels({});
    setAnnouncements([]);
    setError(null);
    setNotice(null);
  }, [address]);

  const load = useCallback(async (current: Session) => {
    setLoading(true);
    try {
      const [directory, messages] = await Promise.all([fetchDirectory(current), fetchMessages(current)]);
      if (!live.current) return;
      setProfiles(directory);
      setInbox(messages.inbox);
      setSent(messages.sent);
      setOverheard(messages.overheard ?? []);
      setChannels(messages.channels ?? {});
      setAnnouncements(messages.announcements ?? []);
      setError(null);
    } catch (e) {
      if (!live.current) return;
      if (e instanceof SessionExpired) setSession(null);
      setError(reason(e) || null);
    } finally {
      if (live.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    void load(session);
  }, [session, load]);

  const signIn = useCallback(async () => {
    if (!address) return;
    setSigningIn(true);
    setError(null);
    try {
      const opened = await openSession(address, sign);
      if (live.current) setSession(opened);
    } catch (e) {
      const message = reason(e);
      if (live.current && message) setError(message);
    } finally {
      if (live.current) setSigningIn(false);
    }
  }, [address, sign]);

  const signOut = useCallback(async () => {
    const current = session;
    setSession(null);
    setProfiles({});
    setInbox([]);
    setSent([]);
    setOverheard([]);
    setChannels({});
    setAnnouncements([]);
    setNotice(null);
    await closeSession(current);
  }, [session]);

  const save = useCallback(async (profile: NetworkingProfile) => {
    if (!session) return false;
    setSaving(true);
    setError(null);
    try {
      const published = await saveProfile(session, profile);
      if (live.current) {
        setProfiles((current) => ({ ...current, [published.address]: published }));
        setNotice('Your card is published to the cabin directory.');
      }
      return true;
    } catch (e) {
      if (live.current) {
        if (e instanceof SessionExpired) setSession(null);
        setError(reason(e) || null);
      }
      return false;
    } finally {
      if (live.current) setSaving(false);
    }
  }, [session]);

  const send = useCallback(async (to: string, body: string) => {
    if (!session) return false;
    setSaving(true);
    setError(null);
    try {
      const message = await sendMessage(session, to, body);
      if (live.current) {
        /* Put it where it will be read back from, so the page shows it
           without waiting for the next poll. Three destinations, the same
           three the server sorts by. */
        const room = zoneOfChannel(to);
        if (to === ANNOUNCEMENT) {
          setAnnouncements((current) => [message, ...current]);
          setNotice('Announcement made. The whole aircraft can hear it.');
        } else if (room) {
          setChannels((current) => ({ ...current, [room]: [message, ...(current[room] ?? [])] }));
          setNotice('Posted to your section.');
        } else {
          setSent((current) => [message, ...current]);
          setNotice('Introduction sent.');
        }
      }
      return true;
    } catch (e) {
      if (live.current) {
        if (e instanceof SessionExpired) setSession(null);
        setError(reason(e) || null);
      }
      return false;
    } finally {
      if (live.current) setSaving(false);
    }
  }, [session]);

  const hearAft = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      // `rooms=all` is own *and* behind, so this replaces rather than merges.
      const messages = await fetchMessages(session, 'all');
      if (live.current) setChannels(messages.channels ?? {});
    } catch (e) {
      if (live.current) {
        if (e instanceof SessionExpired) setSession(null);
        setError(reason(e) || null);
      }
    } finally {
      if (live.current) setLoading(false);
    }
  }, [session]);

  const dismiss = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  return {
    available: hasDirectory,
    session, profiles, inbox, sent, overheard, channels, announcements,
    loading, signingIn, saving, error, notice,
    signIn, signOut, save, send, hearAft, dismiss,
  };
}
