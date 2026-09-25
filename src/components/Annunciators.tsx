import type { Annunciators as LampState } from '../lib/flightModel';
import { DeckIcon, type DeckIconName } from './InstrumentDeck';

/**
 * The overhead panel.
 *
 * Four lamps, and the only two states that matter: lit or dark. Every lamp
 * carries its state as text as well as colour — the glow is the flourish, not
 * the message.
 *
 * With one accent in the palette, caution can no longer be a second hue. It is
 * a second *amount* instead: an advisory lights its lamp, a caution floods the
 * whole cell and pulses. That reads faster than cerise-versus-cyan ever did,
 * and it survives being printed, dimmed, or looked at by someone who does not
 * separate red from green.
 *
 * Each lamp is a key on the panel with its legend in a lens: dark, the lens
 * is smoked glass with the symbol just readable in it; lit, the light is
 * behind the symbol.
 */

interface LampProps {
  label: string;
  icon: DeckIconName;
  on: boolean;
  caution?: boolean;
  detail: string;
}

const Lamp = ({ label, icon, on, caution, detail }: LampProps) => (
  <li className={`sa-lamp ${on ? 'sa-lamp--on' : ''} ${on && caution ? 'sa-lamp--caution' : ''}`}>
    <span aria-hidden className={`sa-lamp__lens ${on && caution ? 'sa-pulse-glow' : ''}`}>
      <DeckIcon name={icon} />
    </span>
    <span className="sa-lamp__copy">
      <span className="sa-lamp__label">{label}</span>
      <span className="sa-lamp__detail"><span className="sa-lamp__state">{on ? 'ON' : 'OFF'}</span>{on ? detail : 'System normal'}</span>
    </span>
  </li>
);

const Annunciators = ({ lamps }: { lamps: LampState }) => (
  <ul aria-label="Overhead annunciator panel" className="sa-lamps">
    <Lamp label="Fasten seat belt" icon="belt" on={lamps.seatbelt} detail="Rough air" />
    <Lamp label="Beverage service" icon="cup" on={lamps.service} detail="Cart rolling" />
    <Lamp label="Oxygen" icon="mask" on={lamps.oxygen} caution detail="Masks down" />
    <Lamp label="Brace" icon="brace" on={lamps.brace} caution detail="Heads down" />
  </ul>
);

export default Annunciators;
