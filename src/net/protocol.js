// ctrl-channel (reliable JSON) message types. State channel is binary (codec.js).

export const MSG = {
  JOIN_REQ: 'joinReq',     // G→H {proto, name, look, resumeToken?}
  JOIN_ACK: 'joinAck',     // H→G {pid, token, name, settings, roster, phase}
  JOIN_DENY: 'joinDeny',   // H→G {reason: 'full'|'started'|'version'}
  ROSTER: 'roster',        // H→all {roster:[{pid,name,look,ready,connected,isHost}]}
  SETTINGS: 'settings',    // H→all {durationMin}
  READY: 'ready',          // G→H {ready}
  LOOK: 'look',            // G→H {look}
  START: 'start',          // H→all {mapSeed, roleSeed, durationMin, roster:[{pid,name,look}]}
  EVENTS: 'ev',            // H→all {tick, evs:[...]}
  KEYFRAME: 'kf',          // H→G  {tick, state}
  REMATCH: 'rematch',      // H→all — back to lobby
  PING: 'ping',            // {t0}
  PONG: 'pong',            // {t0}
  BYE: 'bye',              // H→all — room closed
};

export function deny(reason) {
  return { t: MSG.JOIN_DENY, reason };
}
