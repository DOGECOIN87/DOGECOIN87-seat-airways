import { useEffect, useMemo, useState } from 'react';
import type { Manifest, ManifestEntry } from '../lib/manifest';
import { CABIN_ZONES, type ZoneKey } from '../content/cabin';
import {
  ANNOUNCEMENT,
  canAnnounce,
  canMessage,
  canReadChannel,
  canViewContact,
  channelFor,
  defaultRole,
  isValidExternalUrl,
  outranks,
  sectionLabel,
  shortMember,
} from '../lib/sectionAccess';
import { EMPTY_PROFILE, type NetworkingProfile } from '../lib/networkingApi';
import { useDirectory } from '../lib/useDirectory';

interface NetworkingHubProps {
  manifest: Manifest;
  address: string | null;
  viewerZone: ZoneKey | null;
  sign: (message: string) => Promise<string>;
}

const zoneAccent: Record<ZoneKey, string> = {
  deck: 'border-[#FF668F] bg-[#FFF2F5]',
  first: 'border-[#FF668F] bg-[#FFF2F5]',
  business: 'border-[#8E76E8] bg-[#F6F3FF]',
  exit: 'border-[#00A8D1] bg-[#EFFBFE]',
  economy: 'border-[#00A8D1] bg-[#EFFBFE]',
};

function holderName(entry: ManifestEntry): string {
  return `Holder ${entry.address.slice(0, 4)}`;
}

/** "Business, Exit Row and Economy" — a list a person would read aloud. */
const list = (items: string[]) =>
  items.length <= 1 ? items[0] ?? '' : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const when = (iso: string) => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const Shell = ({ children }: { children: React.ReactNode }) => (
  <section className="ui-card" aria-label="Section networking">
    <div className="px-5 py-6 sm:px-7">
      <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-ui-deep">Section network</p>
      {children}
    </div>
  </section>
);

const NetworkingHub = ({ manifest, address, viewerZone, sign }: NetworkingHubProps) => {
  const directory = useDirectory(address, sign);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<NetworkingProfile>(EMPTY_PROFILE);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [roomDraft, setRoomDraft] = useState('');
  const [paDraft, setPaDraft] = useState('');
  /* Your own cabin is what you get by default. The rooms behind are yours to
     read, but they are somebody else's conversation, and opening on all five
     would bury your own section under whichever one is busiest. */
  const [listeningAft, setListeningAft] = useState(false);

  const published = address ? directory.profiles[address] : undefined;
  const currentEntry = manifest.entries.find((entry) => entry.address === address) ?? null;

  // The card the server holds is what the editor opens on. Re-synced when it
  // arrives, and left alone once somebody is typing into it.
  useEffect(() => {
    if (editing) return;
    setForm(published
      ? {
        displayName: published.displayName,
        role: published.role,
        email: published.email,
        website: published.website,
        linkedin: published.linkedin,
      }
      : EMPTY_PROFILE);
  }, [published, editing]);

  /* The rule, in the only terms that matter to the person reading it: the
     names of the cabins on either side of them. Stated rather than left to
     be worked out from a card that will not open. */
  const sections = useMemo(() => {
    if (!viewerZone) return null;
    /* Cabins with somebody in them, not cabins the aircraft has.
       Seats fill strictly by rank, so at the default manifest size the last
       one taken is the back of business and the two cabins behind it are
       empty — naming them would promise a reader thirty-eight rows of people
       who are not there. The hold is not a cabin at all: no manifest, no
       roster, no name to put to anybody in it. */
    const occupied = new Set(manifest.entries.map((entry) => entry.seat.zone));
    const ahead = CABIN_ZONES.filter((zone) => outranks(zone.key, viewerZone) && occupied.has(zone.key));
    const behind = CABIN_ZONES.filter((zone) => outranks(viewerZone, zone.key) && occupied.has(zone.key));
    return {
      ahead: list(ahead.map((zone) => sectionLabel(zone.key))),
      aheadCount: ahead.length,
      behind: list(behind.map((zone) => sectionLabel(zone.key))),
      behindCount: behind.length,
    };
  }, [viewerZone, manifest.entries]);
  const overheardBy = sections?.ahead ?? '';

  const senders = useMemo(() => {
    const byAddress = new Map(manifest.entries.map((entry) => [entry.address, entry] as const));
    return (from: string) => {
      const entry = byAddress.get(from);
      const name = directory.profiles[from]?.displayName;
      return name || (entry ? holderName(entry) : shortMember(from));
    };
  }, [manifest.entries, directory.profiles]);

  /* The cabins whose rooms this seat may listen to, behind it and occupied.
     Empty cabins are left out for the same reason the header leaves them out:
     naming a room with nobody in it promises a conversation that cannot
     exist. */
  const roomsAft = useMemo(() => {
    if (!viewerZone) return [];
    const occupied = new Set(manifest.entries.map((entry) => entry.seat.zone));
    return CABIN_ZONES
      .filter((zone) => zone.key !== viewerZone && canReadChannel(viewerZone, zone.key) && occupied.has(zone.key))
      .map((zone) => zone.key);
  }, [viewerZone, manifest.entries]);

  const rooms = viewerZone ? [viewerZone, ...(listeningAft ? roomsAft : [])] : [];

  const postToRoom = async () => {
    if (!viewerZone) return;
    const body = roomDraft.trim();
    if (!body) {
      setInvalid('Write something before posting.');
      return;
    }
    setInvalid(null);
    if (await directory.send(channelFor(viewerZone), body)) setRoomDraft('');
  };

  const announce = async () => {
    const body = paDraft.trim();
    if (!body) {
      setInvalid('An announcement needs something to announce.');
      return;
    }
    setInvalid(null);
    if (await directory.send(ANNOUNCEMENT, body)) setPaDraft('');
  };

  const saveCard = async () => {
    if (![form.website, form.linkedin].every(isValidExternalUrl)) {
      setInvalid('Use a full http:// or https:// link for contact URLs.');
      return;
    }
    setInvalid(null);
    if (await directory.save(form)) setEditing(false);
  };

  const submitMessage = async (target: ManifestEntry) => {
    if (!address || !canMessage(viewerZone, target.seat.zone, address, target.address)) return;
    const body = draft.trim();
    if (!body) {
      setInvalid('Write a short introduction before sending.');
      return;
    }
    setInvalid(null);
    if (await directory.send(target.address, body)) setDraft('');
  };

  if (!manifest.entries.length) {
    return (
      <Shell>
        <h3 className="font-heading mt-2 text-2xl leading-tight text-ui-ink">The cabin network opens at boarding</h3>
        <p className="mt-2 max-w-[58ch] text-[13px] leading-relaxed text-ui-soft">
          Connect a wallet to see the live roster. Where you sit decides what you can read: the contact details of
          your own section and every cabin behind it, and the conversations happening back there. The rows in front
          of you are closed, which is what makes the next seat up worth taking.
        </p>
      </Shell>
    );
  }

  if (!directory.available) {
    return (
      <Shell>
        <h3 className="font-heading mt-2 text-2xl leading-tight text-ui-ink">The directory is not connected</h3>
        <p className="mt-2 max-w-[58ch] text-[13px] leading-relaxed text-ui-soft">
          This deployment has no directory service configured, so cards and introductions have nowhere to live.
          Set <code className="font-mono text-[12px]">VITE_DIRECTORY_API</code> to a Worker with its database bound.
        </p>
      </Shell>
    );
  }

  const status = directory.error ?? invalid ?? directory.notice;
  const statusIsError = Boolean(directory.error ?? invalid);

  return (
    <section className="ui-card" aria-label="Section networking">
      <header className="ui-rule-b px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-ui-deep">Section network</p>
            <h3 className="font-heading mt-2 text-2xl leading-tight text-ui-ink">The cabin, from your seat</h3>
            <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-ui-soft">
              {sections ? (
                <>
                  From <strong className="text-ui-ink">{sectionLabel(viewerZone as ZoneKey)}</strong> you read your own
                  section{sections.behindCount ? <> and everything behind it — {sections.behind}</> : <>, and nobody is seated behind you</>}.{' '}
                  {sections.aheadCount
                    ? <>{sections.ahead} {sections.aheadCount === 1 ? 'reads' : 'read'} you, and you cannot read them.</>
                    : <>Nothing is ahead of you. The whole aircraft is yours to read.</>}
                </>
              ) : (
                <>
                  Every holder is on the roster. Claim a seat and it decides how far up the aircraft you can read:
                  your own section and every cabin behind it, and none of the ones in front.
                </>
              )}
            </p>
          </div>
          <div className="rounded-full border border-[#FFB300]/40 bg-[#FFF9E8] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#8A5A00]">
            {viewerZone ? `${sectionLabel(viewerZone)} access` : 'Connect to unlock'}
          </div>
        </div>
        <div className="mt-5 grid gap-2 text-[11px] leading-relaxed text-ui-soft sm:grid-cols-2">
          <p className="rounded-xl border border-ui-line bg-ui-bg px-3 py-2.5">
            <strong className="text-ui-ink">Names</strong> are the roster and belong to everyone.{' '}
            <strong className="text-ui-ink">Contact details</strong> go to the holder's own section and every cabin
            behind it — an email you publish is read by the rows ahead of you, never by the ones behind.
          </p>
          <p className="rounded-xl border border-ui-line bg-ui-bg px-3 py-2.5">
            <strong className="text-ui-ink">Conversations</strong> are readable by the two wallets on them and by any
            section ahead of both — so the flight deck hears the aircraft, and your own section never hears you.
          </p>
        </div>
      </header>

      {/* The PA.

          Above everything else because that is what a public address is: the
          one thing on this aeroplane the whole cabin hears at once, the hold
          included. It is shown to everybody and written by the flight deck,
          once a day, which is the perk their boarding pass has promised since
          long before there was anywhere to keep it. */}
      {directory.session && (directory.announcements.length > 0 || canAnnounce(viewerZone)) && (
        <div className="border-t border-ui-line bg-[#FFFBEA] px-5 py-5 sm:px-7">
          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#8A6D00]">The PA</p>
          {directory.announcements.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {directory.announcements.map((message) => (
                <li key={message.id} className="rounded-xl border border-[#E6D08A] bg-white/70 px-3.5 py-3">
                  <p className="text-[13px] leading-relaxed text-ui-ink">{message.body}</p>
                  <p className="mt-1.5 text-[10px] uppercase tracking-[0.14em] text-ui-faint">
                    {senders(message.from)} · {when(message.sentAt)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12px] text-ui-soft">Nothing announced yet.</p>
          )}

          {canAnnounce(viewerZone) && (
            <div className="mt-4 rounded-xl border border-[#E6D08A] bg-white/70 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8A6D00]">Yours to use</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ui-soft">
                One announcement a day, heard by every cabin and by the hold. Use it well.
              </p>
              <textarea
                value={paDraft}
                onChange={(event) => setPaDraft(event.target.value)}
                placeholder="Cabin crew, doors to arrival…"
                rows={2}
                maxLength={1000}
                className="mt-2 w-full resize-none rounded-lg border border-ui-line bg-white px-3 py-2 text-[12px] text-ui-ink outline-none focus:border-[#C8A93B]"
              />
              <button type="button" onClick={() => void announce()} disabled={directory.saving} className="sa-cta mt-2 disabled:opacity-60">
                {directory.saving ? 'Announcing…' : 'Announce to the aircraft'} <span aria-hidden>→</span>
              </button>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
        <div className="space-y-3">
          {manifest.entries.map((entry) => {
            const sameSection = canViewContact(viewerZone, entry.seat.zone);
            const messageable = canMessage(viewerZone, entry.seat.zone, address, entry.address);
            const active = selected === entry.address;
            const card = directory.profiles[entry.address];
            return (
              <article key={entry.address} className={`rounded-2xl border p-4 transition-colors ${zoneAccent[entry.seat.zone]}`}>
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-3 text-left"
                  onClick={() => setSelected(active ? null : entry.address)}
                  aria-expanded={active}
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-heading text-lg text-ui-ink">{card?.displayName || holderName(entry)}</span>
                      {entry.address === address && <span className="rounded-full bg-ui-ink px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-white">You</span>}
                    </span>
                    <span className="mt-1 block text-[11px] uppercase tracking-[0.14em] text-ui-soft">
                      {sectionLabel(entry.seat.zone)} · seat {entry.seat.id} · {card?.role || defaultRole(entry.seat.zone)}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-ui-deep">{active ? 'Close' : 'Open'}</span>
                </button>

                {active && (
                  <div className="mt-4 border-t border-black/10 pt-4">
                    {sameSection ? (
                      <div className="space-y-2 text-[12px] text-ui-soft">
                        <p className="font-semibold text-ui-ink">
                          {entry.seat.zone === viewerZone ? 'Same-section contact card' : `${sectionLabel(entry.seat.zone)} contact card`}
                        </p>
                        {entry.address === address ? (
                          <>
                            <p>Your card is shown to {sectionLabel(entry.seat.zone)} and to every cabin ahead of it.</p>
                            <button type="button" onClick={() => setEditing((value) => !value)} className="sa-cta mt-2">{editing ? 'Close editor' : 'Edit your card'} <span aria-hidden>→</span></button>
                          </>
                        ) : !directory.session ? (
                          <p>Sign in to the directory to read contact details.</p>
                        ) : !card ? (
                          <p>This holder has not published a card yet.</p>
                        ) : card.readable ? (
                          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                            <span>Email: {card.email || 'Not given'}</span>
                            {card.website && <a className="underline" href={card.website} target="_blank" rel="noreferrer">Website</a>}
                            {card.linkedin && <a className="underline" href={card.linkedin} target="_blank" rel="noreferrer">LinkedIn</a>}
                          </div>
                        ) : (
                          /* The page thinks this card is level with you or
                             behind you and the server disagrees, so the two
                             are reading different seating — a directory with
                             no holder feed, or one still holding a minute-old
                             copy of it. Saying "forward of you" here would be
                             a confident wrong answer. */
                          <p>Their links are not being shown: the directory and the page disagree about where you are sitting.</p>
                        )}
                        {messageable && directory.session && (
                          <div className="mt-4 rounded-xl border border-[#FF668F]/30 bg-white/70 p-3">
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#B3265E]">
                              {entry.seat.zone === viewerZone ? 'Same-section introduction' : `Introduction to ${sectionLabel(entry.seat.zone)}`}
                            </p>
                            {/* Nobody should learn this from the seat in front
                                quoting them. It is the first thing the box says. */}
                            <p className="mt-1.5 text-[11px] leading-relaxed text-ui-soft">
                              {overheardBy
                                ? `Readable by ${overheardBy}, as well as by the two of you.`
                                : 'Readable by the two of you. Nobody is seated ahead of this conversation.'}
                            </p>
                            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Introduce your company, campaign, or partnership idea…" rows={3} maxLength={1000} className="mt-2 w-full resize-none rounded-lg border border-ui-line bg-white px-3 py-2 text-[12px] text-ui-ink outline-none focus:border-[#FF668F]" />
                            <button type="button" onClick={() => void submitMessage(entry)} disabled={directory.saving} className="sa-cta mt-2 disabled:opacity-60">{directory.saving ? 'Sending…' : 'Send message'} <span aria-hidden>→</span></button>
                          </div>
                        )}
                        {/* There is no "you cannot write to this one" line any
                            more, and nothing to put in its place: a card you
                            can read is a card you can answer. The cabins you
                            cannot write to are the ones ahead of you, and they
                            do not reach this branch — they say so themselves,
                            below, in the terms that actually explain it. */}
                      </div>
                    ) : (
                      <p className="text-[12px] leading-relaxed text-ui-soft">
                        This card is in a cabin ahead of yours. You can read your own section and everything behind
                        it — the view forward is what the next seat up buys.
                      </p>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>

        <aside className="rounded-2xl border border-ui-line bg-ui-bg p-4 sm:p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-ui-deep">Your networking card</p>

          {!address ? (
            <p className="mt-4 text-[12px] leading-relaxed text-ui-soft">Connect a wallet and claim a seat to publish a networking card.</p>
          ) : !directory.session ? (
            <div className="mt-4 space-y-3 text-[12px] leading-relaxed text-ui-soft">
              <p>
                Sign a one-line message to open the directory: the roster, the cards your seat lets you read, and
                your introductions. It proves the wallet is yours, lasts a day, and authorises no transaction.
              </p>
              <button type="button" onClick={() => void directory.signIn()} disabled={directory.signingIn} className="sa-cta w-full justify-center disabled:opacity-60">
                {directory.signingIn ? 'Check your wallet…' : 'Sign in to the directory'} <span aria-hidden>→</span>
              </button>
            </div>
          ) : !currentEntry ? (
            <p className="mt-4 text-[12px] leading-relaxed text-ui-soft">Claim a seat to publish a networking card. You can still read introductions sent to you.</p>
          ) : editing ? (
            <div className="mt-4 space-y-3">
              {([
                ['displayName', 'Name or company'],
                ['role', 'Role / what you are building'],
                ['email', 'Email'],
                ['website', 'Website URL'],
                ['linkedin', 'LinkedIn URL'],
              ] as const).map(([key, label]) => (
                <label key={key} className="block text-[10px] font-bold uppercase tracking-[0.14em] text-ui-faint">
                  {label}
                  <input value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className="mt-1 w-full rounded-lg border border-ui-line bg-white px-3 py-2 text-[12px] font-normal normal-case tracking-normal text-ui-ink outline-none focus:border-ui-blue" />
                </label>
              ))}

              <p className="rounded-lg border border-ui-line bg-white px-3 py-2.5 text-[11px] leading-relaxed text-ui-soft">
                Your card is read by holders, and only by holders: the directory opens to a wallet that holds the
                token and to nobody else. The page puts your contact details in front of your own section.
              </p>
              <button type="button" onClick={() => void saveCard()} disabled={directory.saving} className="sa-cta w-full justify-center disabled:opacity-60">
                {directory.saving ? 'Publishing…' : 'Publish card'} <span aria-hidden>→</span>
              </button>
            </div>
          ) : (
            <div className="mt-4 space-y-2 text-[12px] text-ui-soft">
              <p className="font-heading text-xl text-ui-ink">{form.displayName || shortMember(address)}</p>
              <p>{form.role || defaultRole(currentEntry.seat.zone)} · {sectionLabel(currentEntry.seat.zone)}</p>
              <p className="pt-2 text-[11px] leading-relaxed">
                {published
                  ? `Published ${when(published.updated)}, to holders only. It is stored against your wallet, so it follows you to any browser.`
                  : 'Nothing published yet. A card is stored against your wallet, so it follows you to any browser.'}
              </p>
              <button type="button" onClick={() => setEditing(true)} className="sa-cta mt-2">{published ? 'Edit card' : 'Publish a card'} <span aria-hidden>→</span></button>
            </div>
          )}

          {directory.session && (
            <div className="mt-5 border-t border-ui-line pt-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-ui-deep">Introductions</p>
              {directory.loading ? (
                <p className="mt-3 text-[11px] text-ui-soft">Reading your inbox…</p>
              ) : directory.inbox.length ? (
                <ul className="mt-3 max-h-64 space-y-3 overflow-y-auto pr-1">
                  {directory.inbox.map((message) => (
                    <li key={message.id} className="rounded-xl border border-ui-line bg-white px-3 py-2.5">
                      <p className="text-[11px] font-semibold text-ui-ink">{senders(message.from)}</p>
                      <p className="mt-1 text-[12px] leading-relaxed text-ui-soft">{message.body}</p>
                      <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-ui-faint">{when(message.sentAt)}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-[11px] text-ui-soft">No introductions yet.</p>
              )}
              {directory.sent.length > 0 && (
                <p className="mt-3 text-[11px] text-ui-soft">{directory.sent.length} sent from this wallet.</p>
              )}

              {/* The other half of the rule: what carries forward from the
                  cabins behind you, because your seat is ahead of both ends
                  of it. */}
              {directory.overheard.length > 0 && (
                <div className="mt-5 border-t border-ui-line pt-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-ui-deep">From behind you</p>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-ui-soft">
                    Conversations between wallets seated aft of {sectionLabel(viewerZone as ZoneKey)}. They cannot
                    read yours.
                  </p>
                  <ul className="mt-3 max-h-64 space-y-3 overflow-y-auto pr-1">
                    {directory.overheard.map((message) => (
                      <li key={message.id} className="rounded-xl border border-ui-line bg-white/60 px-3 py-2.5">
                        <p className="text-[11px] font-semibold text-ui-ink">
                          {senders(message.from)} <span className="font-normal text-ui-faint">to</span> {senders(message.to)}
                        </p>
                        <p className="mt-1 text-[12px] leading-relaxed text-ui-soft">{message.body}</p>
                        <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-ui-faint">{when(message.sentAt)}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button type="button" onClick={() => void directory.signOut()} className="mt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-ui-deep underline">
                Sign out of the directory
              </button>
            </div>
          )}

          {status && (
            <p
              role="status"
              onClick={directory.dismiss}
              className={`mt-4 rounded-lg px-3 py-2 text-[11px] font-semibold ${statusIsError ? 'bg-[#FDECEC] text-[#96201F]' : 'bg-[#E8F7EF] text-[#17683B]'}`}
            >
              {status}
            </p>
          )}
        </aside>
      </div>

      {/* The rooms.

          A cabin is somewhere to talk as well as somewhere to sit. You post
          in your own and read every one behind it — so the reading is the
          same line as a contact card, and the posting is narrower than both.
          A section's conversation belongs to the people sitting in it.

          Opens on your own cabin. The rest are a button away rather than
          always on, because five rooms at once buries the one you are in
          under whichever is busiest. */}
      {directory.session && viewerZone && (
        <div className="border-t border-ui-line px-5 py-6 sm:px-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-ui-deep">The rooms</p>
              <h3 className="font-heading mt-1 text-xl leading-tight text-ui-ink">
                {sectionLabel(viewerZone)} is talking
              </h3>
            </div>
            {roomsAft.length > 0 && (
              <button
                type="button"
                onClick={() => setListeningAft((value) => !value)}
                aria-pressed={listeningAft}
                className="rounded-full border border-ui-line px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-ui-deep transition-colors hover:bg-black/5"
              >
                {listeningAft
                  ? `Just ${sectionLabel(viewerZone)}`
                  : `Listen to ${list(roomsAft.map((zone) => sectionLabel(zone)))} too`}
              </button>
            )}
          </div>

          <p className="mt-2 max-w-[74ch] text-[12px] leading-relaxed text-ui-soft">
            You speak in your own cabin. You can hear every cabin behind it and none ahead — so the rows in front
            of you hear this one, and you hear the rows behind.
          </p>

          <div className="mt-4 rounded-2xl border border-ui-line bg-white/70 p-3.5">
            <textarea
              value={roomDraft}
              onChange={(event) => setRoomDraft(event.target.value)}
              placeholder={`Say something to ${sectionLabel(viewerZone)}…`}
              rows={2}
              maxLength={1000}
              className="w-full resize-none rounded-lg border border-ui-line bg-white px-3 py-2 text-[12px] text-ui-ink outline-none focus:border-[#FF668F]"
            />
            <button type="button" onClick={() => void postToRoom()} disabled={directory.saving} className="sa-cta mt-2 disabled:opacity-60">
              {directory.saving ? 'Posting…' : `Post to ${sectionLabel(viewerZone)}`} <span aria-hidden>→</span>
            </button>
          </div>

          <div className={`mt-5 grid gap-4 ${rooms.length > 1 ? 'lg:grid-cols-2' : ''}`}>
            {rooms.map((zone) => {
              const said = directory.channels[zone] ?? [];
              return (
                <div key={zone} className={`rounded-2xl border p-4 ${zoneAccent[zone]}`}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ui-deep">
                    {sectionLabel(zone)}
                    {zone === viewerZone
                      ? ' · yours'
                      : ' · you are listening, they cannot hear you'}
                  </p>
                  {said.length ? (
                    <ul className="mt-3 max-h-72 space-y-2.5 overflow-y-auto pr-1">
                      {said.map((message) => (
                        <li key={message.id} className="rounded-xl border border-ui-line bg-white/80 px-3 py-2.5">
                          <p className="text-[11px] font-semibold text-ui-ink">{senders(message.from)}</p>
                          <p className="mt-1 text-[12px] leading-relaxed text-ui-soft">{message.body}</p>
                          <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-ui-faint">{when(message.sentAt)}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-[11px] text-ui-soft">
                      {zone === viewerZone ? 'Nobody has said anything yet. Go first.' : 'Quiet back there.'}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};

export default NetworkingHub;
