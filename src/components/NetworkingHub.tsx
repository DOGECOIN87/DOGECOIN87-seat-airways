import { useMemo, useState } from 'react';
import type { Manifest, ManifestEntry } from '../lib/manifest';
import type { ZoneKey } from '../content/cabin';
import {
  canMessage,
  canViewContact,
  defaultRole,
  isValidExternalUrl,
  readMessages,
  readProfile,
  sectionLabel,
  shortMember,
  writeMessage,
  writeProfile,
  type NetworkingProfile,
} from '../lib/sectionAccess';

interface NetworkingHubProps {
  manifest: Manifest;
  address: string | null;
  viewerZone: ZoneKey | null;
}

const zoneAccent: Record<ZoneKey, string> = {
  deck: 'border-[#FF668F] bg-[#FFF2F5]',
  first: 'border-[#FF668F] bg-[#FFF2F5]',
  business: 'border-[#8E76E8] bg-[#F6F3FF]',
  exit: 'border-[#00A8D1] bg-[#EFFBFE]',
  economy: 'border-[#00A8D1] bg-[#EFFBFE]',
};

function displayName(entry: ManifestEntry): string {
  return `Holder ${entry.address.slice(0, 4)}`;
}

const NetworkingHub = ({ manifest, address, viewerZone }: NetworkingHubProps) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [profile, setProfile] = useState<NetworkingProfile>(() => readProfile(address));
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const messages = useMemo(() => readMessages(address), [address, notice]);
  const currentEntry = manifest.entries.find((entry) => entry.address === address) ?? null;

  const saveProfile = () => {
    if (!address) return;
    if (![profile.website, profile.linkedin].every(isValidExternalUrl)) {
      setNotice('Use a full http:// or https:// link for contact URLs.');
      return;
    }
    writeProfile(address, profile);
    setEditing(false);
    setNotice('Your same-section card is updated.');
  };

  const sendMessage = (target: ManifestEntry) => {
    if (!address || !canMessage(viewerZone, target.seat.zone, address, target.address)) return;
    const body = draft.trim();
    if (!body) {
      setNotice('Write a short introduction before sending.');
      return;
    }
    writeMessage({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      from: address,
      to: target.address,
      body,
      sentAt: new Date().toISOString(),
    });
    setDraft('');
    setNotice(`Message queued for ${displayName(target)} in this browser.`);
  };

  if (!manifest.entries.length) {
    return (
      <section className="ui-card" aria-label="Section networking">
        <div className="px-5 py-6 sm:px-7">
          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-ui-deep">Section network</p>
          <h3 className="font-heading mt-2 text-2xl leading-tight text-ui-ink">The cabin network opens at boarding</h3>
          <p className="mt-2 max-w-[58ch] text-[13px] leading-relaxed text-ui-soft">
            Connect a wallet to see the live section roster. Contact links are a same-section perk, while First
            Class members get the private introduction channel.
          </p>
        </div>
      </section>
    );
  }

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
            <strong className="text-ui-ink">Contacts:</strong> visible only between members assigned to the same section.
          </p>
          <p className="rounded-xl border border-ui-line bg-ui-bg px-3 py-2.5">
            <strong className="text-ui-ink">Messages:</strong> First Class members can message other First Class members.
          </p>
        </div>
      </header>

      <div className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
        <div className="space-y-3">
          {manifest.entries.map((entry) => {
            const sameSection = canViewContact(viewerZone, entry.seat.zone);
            const messageable = canMessage(viewerZone, entry.seat.zone, address, entry.address);
            const active = selected === entry.address;
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
                      <span className="font-heading text-lg text-ui-ink">{displayName(entry)}</span>
                      {entry.address === address && <span className="rounded-full bg-ui-ink px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-white">You</span>}
                    </span>
                    <span className="mt-1 block text-[11px] uppercase tracking-[0.14em] text-ui-soft">
                      {sectionLabel(entry.seat.zone)} · seat {entry.seat.id} · {defaultRole(entry.seat.zone)}
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
                          <p>Your links are private to fellow {sectionLabel(entry.seat.zone)} members.</p>
                        ) : (
                          <p>Contact details are unlocked because you share the {sectionLabel(entry.seat.zone)} section.</p>
                        )}
                        {entry.address === address ? (
                          <button type="button" onClick={() => setEditing((value) => !value)} className="sa-cta mt-2">{editing ? 'Close editor' : 'Edit your card'} <span aria-hidden>→</span></button>
                        ) : (
                          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                            <span>Email: {readProfile(entry.address).email || 'Not shared'}</span>
                            {readProfile(entry.address).website && <a className="underline" href={readProfile(entry.address).website} target="_blank" rel="noreferrer">Website</a>}
                            {readProfile(entry.address).linkedin && <a className="underline" href={readProfile(entry.address).linkedin} target="_blank" rel="noreferrer">LinkedIn</a>}
                          </div>
                        )}
                        {messageable && (
                          <div className="mt-4 rounded-xl border border-[#FF668F]/30 bg-white/70 p-3">
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#B3265E]">First Class introduction</p>
                            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Introduce your company, campaign, or partnership idea…" rows={3} className="mt-2 w-full resize-none rounded-lg border border-ui-line bg-white px-3 py-2 text-[12px] text-ui-ink outline-none focus:border-[#FF668F]" />
                            <button type="button" onClick={() => sendMessage(entry)} className="sa-cta mt-2">Send message <span aria-hidden>→</span></button>
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
          {currentEntry ? (
            editing ? (
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
                    <input value={profile[key]} onChange={(event) => setProfile((current) => ({ ...current, [key]: event.target.value }))} className="mt-1 w-full rounded-lg border border-ui-line bg-white px-3 py-2 text-[12px] font-normal normal-case tracking-normal text-ui-ink outline-none focus:border-ui-blue" />
                  </label>
                ))}
                <button type="button" onClick={saveProfile} className="sa-cta w-full justify-center">Save private card <span aria-hidden>→</span></button>
              </div>
            ) : (
              <div className="mt-4 space-y-2 text-[12px] text-ui-soft">
                <p className="font-heading text-xl text-ui-ink">{profile.displayName || shortMember(address ?? '')}</p>
                <p>{profile.role || defaultRole(currentEntry.seat.zone)} · {sectionLabel(currentEntry.seat.zone)}</p>
                <p className="pt-2 text-[11px] leading-relaxed">Only members in your section can see these contact details. They are stored in this browser until a profile service is connected.</p>
                <button type="button" onClick={() => setEditing(true)} className="sa-cta mt-2">Edit card <span aria-hidden>→</span></button>
              </div>
            )
          ) : (
            <p className="mt-4 text-[12px] leading-relaxed text-ui-soft">Connect a wallet and claim a seat to publish a private networking card.</p>
          )}
          {messages.length > 0 && <p className="mt-5 border-t border-ui-line pt-4 text-[11px] text-ui-soft">{messages.length} introduction{messages.length === 1 ? '' : 's'} queued from this browser.</p>}
          {notice && <p role="status" className="mt-4 rounded-lg bg-[#E8F7EF] px-3 py-2 text-[11px] font-semibold text-[#17683B]">{notice}</p>}
        </aside>
      </div>
    </section>
  );
};

export default NetworkingHub;
