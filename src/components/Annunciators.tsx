import type { Annunciators as LampState } from '../lib/flightModel';

/**
 * The overhead panel.
 *
 * Four lamps, and the only two states that matter: lit or dark. Caution lamps
 * (oxygen, brace) burn cerise and pulse; advisory lamps (seat belt, service)
 * sit steady in cyan. Every lamp carries its state as text as well as colour —
 * the glow is the flourish, not the message.
 */

interface LampProps {
  label: string;
  on: boolean;
  caution?: boolean;
  detail: string;
}

const Lamp = ({ label, on, caution, detail }: LampProps) => {
  const colour = caution ? '#FFB300' : '#3FD8E8';
  return (
    <li
      className={`relative flex min-w-0 flex-1 items-center gap-3 border-r border-white/10 px-4 py-3.5 last:border-r-0 ${
        on ? 'bg-white/[0.045]' : ''
      }`}
    >
      <span
        aria-hidden
        className={`h-2.5 w-2.5 flex-none ${on && caution ? 'sa-pulse-glow' : ''}`}
        style={{
          borderRadius: '9999px',
          background: on
            ? `radial-gradient(circle at 34% 30%, #ffffff, ${colour} 62%)`
            : '#1E2A50',
          boxShadow: on ? `0 0 12px ${colour}, 0 0 26px ${colour}66` : 'inset 0 0 4px rgba(0,0,0,0.7)',
        }}
      />
      <span className="min-w-0">
        <span
          className={`block truncate text-[11px] font-bold uppercase tracking-[0.18em] ${
            on ? 'text-white' : 'text-blue-100/35'
          }`}
        >
          {label}
        </span>
        <span className="block truncate text-[10px] uppercase tracking-[0.14em] text-blue-100/35">
          {on ? detail : 'Off'}
        </span>
      </span>
    </li>
  );
};

const Annunciators = ({ lamps }: { lamps: LampState }) => (
  <ul
    aria-label="Overhead annunciator panel"
    className="flex overflow-x-auto border-y border-white/10 bg-[#141821]/70 backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
  >
    <Lamp label="Fasten seat belt" on={lamps.seatbelt} detail="Rough air" />
    <Lamp label="Beverage service" on={lamps.service} detail="Cart rolling" />
    <Lamp label="Oxygen" on={lamps.oxygen} caution detail="Masks down" />
    <Lamp label="Brace" on={lamps.brace} caution detail="Heads down" />
  </ul>
);

export default Annunciators;
