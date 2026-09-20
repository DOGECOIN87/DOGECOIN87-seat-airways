import { useEffect, useMemo, useState } from 'react';
import type { Manifest, ManifestEntry } from '../lib/manifest';
import type { ZoneKey } from '../content/cabin';
import {
  canMessage,
  canViewContact,
  defaultRole,
  isValidExternalUrl,
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

  const senders = useMemo(() => {
    const byAddress = new Map(manifest.entries.map((entry) => [entry.address, entry] as const));
    return (from: string) => {
      const entry = byAddress.get(from);
      const name = directory.profiles[from]?.displayName;
      return name || (entry ? holderName(entry) : shortMember(from));
    };
  }, [manifest.entries, directory.profiles]);

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
          Connect a wallet to see the live section roster. Contact links are a same-section perk, while First
          Class members get the private introduction channel.
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
            <h3 className="font-heading mt-2 text-2xl leading-tight text-ui-ink">The people in your section</h3>
            <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-ui-soft">
              Your seat is more than placement. It is an access tier for meeting builders, advertisers, and partners
              who are flying at the same level.
            </p>
          </div>
          <div className="rounded-full border border-[#FFB300]/40 bg-[#FFF9E8] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#8A5A00]">
            {viewerZone ? `${sectionLabel(viewerZone)} access` : 'Connect to unlock'}
          </div>
        </div>
        <div className="mt-5 grid gap-2 text-[11px] leading-relaxed text-ui-soft sm:grid-cols-2">
          <p className="rounded-xl border border-ui-line bg-ui-bg px-3 py-2.5">
            <strong className="text-ui-ink">Contacts:</strong> holders only — the directory opens to a wallet that
            holds the token. The page surfaces them to members of your own section.
          </p>
          <p className="rounded-xl border border-ui-line bg-ui-bg px-3 py-2.5">
            <strong className="text-ui-ink">Messages:</strong> First Class members can message other First Class
            members, and only the two wallets on one can read it.
          </p>
        </div>
      </header>

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
                        <p className="font-semibold text-ui-ink">Same-section contact card</p>
                        {entry.address === address ? (
                          <>
                            <p>Your card is shown to fellow {sectionLabel(entry.seat.zone)} members.</p>
                            <button type="button" onClick={() => setEditing((value) => !value)} className="sa-cta mt-2">{editing ? 'Close editor' : 'Edit your card'} <span aria-hidden>→</span></button>
                          </>
                        ) : !directory.session ? (
                          <p>Sign in to the directory to read contact details.</p>
                        ) : !card ? (
                          <p>This holder has not published a card yet.</p>
                        ) : (
                          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                            <span>Email: {card.email || 'Not given'}</span>
                            {card.website && <a className="underline" href={card.website} target="_blank" rel="noreferrer">Website</a>}
                            {card.linkedin && <a className="underline" href={card.linkedin} target="_blank" rel="noreferrer">LinkedIn</a>}
                          </div>
                        )}
                        {messageable && directory.session && (
                          <div className="mt-4 rounded-xl border border-[#FF668F]/30 bg-white/70 p-3">
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#B3265E]">First Class introduction</p>
                            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Introduce your company, campaign, or partnership idea…" rows={3} maxLength={1000} className="mt-2 w-full resize-none rounded-lg border border-ui-line bg-white px-3 py-2 text-[12px] text-ui-ink outline-none focus:border-[#FF668F]" />
                            <button type="button" onClick={() => void submitMessage(entry)} disabled={directory.saving} className="sa-cta mt-2 disabled:opacity-60">{directory.saving ? 'Sending…' : 'Send message'} <span aria-hidden>→</span></button>
                          </div>
                        )}
                        {!messageable && entry.address !== address && (
                          <p className="mt-3 rounded-lg bg-black/5 px-3 py-2 text-[11px]">Messaging is reserved for First Class-to-First Class introductions.</p>
                        )}
                      </div>
                    ) : (
                      <p className="text-[12px] leading-relaxed text-ui-soft">Contact details are private to members of the same section. Your current access does not include this card.</p>
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
                Sign a one-line message to open the directory. It proves the wallet is yours, lasts a day, and
                authorises no transaction.
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
    </section>
  );
};

export default NetworkingHub;
