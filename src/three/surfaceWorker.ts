import { cloudSeaData, earthData, lunarData, marsData, type Plane } from './surfaceData';

/**
 * Builds the other worlds off the main thread.
 *
 * Asked for one by name, it answers with its planes and hands the buffers
 * over rather than copying them. A second or so of arithmetic per world is
 * nothing here, and would be a stall of the whole flight anywhere else.
 */
const build = { clouds: cloudSeaData, earth: earthData, moon: lunarData, mars: marsData } as const;

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<keyof typeof build>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

scope.onmessage = (event) => {
  const kind = event.data;
  const out = build[kind]();
  const planes: Plane[] = 'macro' in out ? [out.macro, out.globe] : [out.day, out.height, out.normal];
  scope.postMessage({ kind, out }, planes.map((p) => p.data.buffer as ArrayBuffer));
};
