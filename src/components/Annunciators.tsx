import type { Annunciators as LampState } from '../lib/flightModel';

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
 */

interface LampProps {
  label: string;
  on: boolean;
  caution?: boolean;
  detail: string;
}

const Lamp = ({ label, on, caution, detail }: LampProps) => (
  <li className={`sa-lamp ${on ? 'sa-lamp--on' : ''} ${on && caution ? 'sa-lamp--caution' : ''}`}>
    <span aria-hidden className={`sa-lamp__bulb ${on && caution ? 'sa-pulse-glow' : ''}`} />
    <span className="min-w-0">
      <span className="sa-lamp__label">{label}</span>
      <span className="sa-lamp__detail">{on ? detail : 'Off'}</span>
    </span>
  </li>
);

const Annunciators = ({ lamps }: { lamps: LampState }) => (
  <ul aria-label="Overhead annunciator panel" className="sa-lamps">
    <Lamp label="Fasten seat belt" on={lamps.seatbelt} detail="Rough air" />
    <Lamp label="Beverage service" on={lamps.service} detail="Cart rolling" />
    <Lamp label="Oxygen" on={lamps.oxygen} caution detail="Masks down" />
    <Lamp label="Brace" on={lamps.brace} caution detail="Heads down" />
  </ul>
);

export default Annunciators;
