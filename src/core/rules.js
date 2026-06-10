import { zombieCountFor } from '../config.js';
import { mulberry32, shuffle } from './rng.js';

export { zombieCountFor };

/**
 * Deterministically pick initial zombie pids from roleSeed.
 * @param {number[]} pids active player ids, in roster order
 * @returns {number[]} zombie pids
 */
export function assignRoles(pids, roleSeed) {
  const rng = mulberry32(roleSeed | 0);
  const order = shuffle(rng, pids.slice());
  return order.slice(0, zombieCountFor(pids.length));
}

/**
 * Win evaluation, run at the END of every playing tick.
 * Order matters (spec rules 8–9):
 *   1) no living humans → zombie win (last-tick infection beats the timer)
 *   2) no living zombie players (all dead or cured) → human win
 *   3) timer expired (≥1 human guaranteed alive by #1) → human win
 * Players removed after the reconnect grace are excluded entirely.
 * @returns {'zombie'|'human'|'aborted'|null}
 */
export function evaluateWin(sim) {
  const present = sim.players.filter((p) => p && p.removedAtTick === null);
  const alive = present.filter((p) => p.alive);
  const zombies = alive.filter((p) => p.isZombie);
  const humans = alive.filter((p) => !p.isZombie);
  if (humans.length === 0) return zombies.length > 0 ? 'zombie' : 'aborted';
  if (zombies.length === 0) return 'human';
  if (sim.tick >= sim.endsAtTick) return 'human';
  return null;
}
