// The numbers in the Fair Game Rules, read from the contract settings so the words can never drift from the game.
// Used by the landing page's scroll and the game page's Rules tab. Plain constants only: no chain code comes with it.
import type { RulesNumbers } from "../copy.ts";
import { CONFIG } from "../config.ts";
import {
  CLOCK_CAP_SECONDS, CONQUEST_ADD_SECONDS, CONQUEST_ENDGAME_ADD_SECONDS, CONQUEST_ENDGAME_SECONDS, KEEPER_DELAY_SECONDS, PROTECT_LOCKOUT_SECONDS,
} from "../refereeParams.ts";

const K = CONFIG.kingdom;
const unit = 10n ** BigInt(CONFIG.pusdDecimals);
const pusd = (v: bigint) => (v % unit === 0n ? String(v / unit) : (Number(v) / Number(unit)).toFixed(CONFIG.pusdDecimals));
const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export const span = (seconds: number, one: string, many: string) => `${seconds} ${seconds === 1 ? one : many}`;
// "30 seconds", "2 minutes"
export const duration = (seconds: number) => (seconds % 60 === 0 ? span(seconds / 60, "minute", "minutes") : span(seconds, "second", "seconds"));
export const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
export const RULES: RulesNumbers = {
  clock: String(CLOCK_CAP_SECONDS / 60),
  add: duration(CONQUEST_ADD_SECONDS),
  endgame: CONQUEST_ENDGAME_SECONDS === 60 ? "a minute" : duration(CONQUEST_ENDGAME_SECONDS),
  endgameTime: clockText(CONQUEST_ENDGAME_SECONDS),
  endgameAdd: duration(CONQUEST_ENDGAME_ADD_SECONDS),
  // the three protect amounts are 1x, 2x and 5x the unit (src/lib/kingdom.ts protectAmounts, not imported: it
  // brings the chain library)
  amounts: `${pusd(K.unit)}, ${pusd(K.unit * 2n)} or ${pusd(K.unit * 5n)}`,
  perReign: COUNT_WORDS[K.protectsPerReign] ?? String(K.protectsPerReign),
  lockout: span(PROTECT_LOCKOUT_SECONDS, "second", "seconds"),
  cap: pusd(K.cap),
  back: `${100n - K.cutPercent}%`,
  fee: `${K.feePercent}%`,
  claim: duration(KEEPER_DELAY_SECONDS),
  blocks: String(CONFIG.fallbackBlocks),
};
