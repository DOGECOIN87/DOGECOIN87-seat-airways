import type { Annunciators as LampState } from '../lib/flightModel';
import { DeckIcon, type DeckIconName } from './InstrumentDeck';

/**
 * The overhead panel.
 *
 * Four lamps, and the only two states that matter: lit or dark. Every lamp
 * carries its state as text as well as colour — the glow is the flourish, not
 * the message.
 *
 * Advisories light in the page's blue. The two alarms take the colours every
 * flight deck gives them — amber for a caution, red for a warning — because a
 * lamp that means masks down must not look like a selected tab. Each alarm
 * also floods its whole key and pulses, so the urgency is in the amount as
 * well as the hue, and survives being printed, dimmed, or looked at by
 * someone who does not separate red from green.
 *
 * Each lamp is a key on the panel with its legend in a lens: dark, the lens
 * is smoked glass with the symbol just readable in it; lit, the light is
 * behind the symbol.
 */

/** Advisory: for information. Caution: act soon. Warning: act now. */
type LampLevel = 'advisory' | 'caution' | 'warning';

interface LampProps {
  label: string;
  icon: DeckIconName;
  on: boolean;
  level?: LampLevel;
  detail: string;
}

const Lamp = ({ label, icon, on, level = 'advisory', detail }: LampProps) => {
  const alarm = on && level !== 'advisory';
  return (
    <li className={`sa-lamp ${on ? 'sa-lamp--on' : ''} ${alarm ? `sa-lamp--${level}` : ''}`}>
      <span aria-hidden className={`sa-lamp__lens ${alarm ? 'sa-pulse-glow' : ''}`}>
        <DeckIcon name={icon} />
      </span>
      <span className="sa-lamp__copy">
        <span className="sa-lamp__label">{label}</span>
        <span className="sa-lamp__detail"><span className="sa-lamp__state">{on ? 'ON' : 'OFF'}</span>{on ? detail : 'System normal'}</span>
      </span>
    </li>
  );
};

const Annunciators = ({ lamps }: { lamps: LampState }) => (
  <ul aria-label="Overhead annunciator panel" className="sa-lamps">
    <Lamp label="Fasten seat belt" icon="belt" on={lamps.seatbelt} detail="Rough air" />
    <Lamp label="Beverage service" icon="cup" on={lamps.service} detail="Cart rolling" />
    <Lamp label="Oxygen" icon="mask" on={lamps.oxygen} level="caution" detail="Masks down" />
    <Lamp label="Brace" icon="brace" on={lamps.brace} level="warning" detail="Heads down" />
  </ul>
);

export default Annunciators;
