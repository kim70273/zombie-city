// Discrete sim events. Host broadcasts these reliably; clients render/apply them.

export const EV = {
  PLAYER_INFECTED: 'pInf',   // {victim, by}            by: pid or npc id string 'n:12'
  PLAYER_CURED: 'pCure',     // {pid, by}
  PLAYER_KILLED: 'pKill',    // {pid, by}
  NPC_INFECTED: 'nInf',      // {id, by}
  NPC_CURED: 'nCure',        // {id, by}
  NPC_KILLED: 'nKill',       // {id, by}
  SHOT: 'shot',              // {pid, x, y, dx, dy}     cosmetic tracer
  HIT: 'hit',                // {kind:'p'|'n', id, hp}  bullet impact feedback
  LUNGE: 'lunge',            // {pid}                   attack animation cue
  CRATE_INCOMING: 'crateIn', // {id, x, y, landTick}
  CRATE_LANDED: 'crateLand', // {id}
  ITEM_PICKED: 'pick',       // {pid, crateId, items}
  MATCH_END: 'end',          // {winner, stats}
  SCREAM: 'scream',          // {id}                    citizen panic cue
};
