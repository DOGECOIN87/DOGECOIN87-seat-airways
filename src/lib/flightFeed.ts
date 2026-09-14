/**
 * The flight feed — the one input the whole cabin reacts to.
 *
 * SEAT AIRLINES reads three numbers and derives everything else from them:
 * market cap becomes altitude, the five-minute change becomes pitch, holders
 * become souls on board. Nothing downstream knows where those numbers came
 * from, which is the point.
 *
 * There is one implementation, in `marketFeed.ts`, and it reads the market.
 * There was a simulator here, and presets to fly it with; both are gone. An
 * aircraft whose attitude can be set by hand is not reporting anything, and a
 * page that can be put into a dive with a button is a toy standing where an
 * instrument should be.
 */

/** One reading from the market, in the units the cabin speaks. */
export interface FlightTick {
  /** Market cap in dollars. Read on the page as altitude in feet. */
  marketCap: number;
  /** Five-minute change in percent. The number that flies the aircraft. */
  change5m: number;
  /** Holder count. Read on the page as souls on board. */
  holders: number;
}

export interface FlightFeed {
  /** Register for ticks. Returns an unsubscribe. */
  subscribe(listener: (tick: FlightTick) => void): () => void;
}

/**
 * What the instruments show before the first reading lands.
 *
 * Level, and at an altitude that puts the aircraft in the weather rather than
 * on the ground — so the first frame is an aeroplane flying, and the numbers
 * correct themselves a moment later when the market answers.
 */
export const INITIAL_TICK: FlightTick = {
  marketCap: 163_000,
  change5m: 0,
  holders: 0,
};
