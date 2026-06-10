// 좀비시티 — every tuning number lives here.

export const TILE = 32;                  // px per tile
export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;   // 50ms fixed timestep
export const SNAPSHOT_EVERY = 2;         // ticks → 10Hz snapshots
export const KEYFRAME_EVERY = 100;       // ticks → 5s reliable keyframes
export const INPUT_SEND_MS = 50;         // guest input send interval (20Hz)
export const INTERP_DELAY_MS = 150;      // remote entity interpolation delay
export const COUNTDOWN_TICKS = 60;       // 3s pre-game countdown

export const MAX_PLAYERS = 10;
export const PROTO_VERSION = 1;
export const ROOM_PREFIX = 'zc1-';
export const ROOM_CODE_LEN = 5;
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// duration(min) → map/balance tier
export const DURATIONS = {
  5:  { tiles: 80,  npcs: 40,  cratesPerDrop: 2 },
  10: { tiles: 110, npcs: 70,  cratesPerDrop: 2 },
  20: { tiles: 140, npcs: 110, cratesPerDrop: 3 },
  30: { tiles: 170, npcs: 150, cratesPerDrop: 3 },
  50: { tiles: 200, npcs: 200, cratesPerDrop: 4 },
};
export const DURATION_CHOICES = [5, 10, 20, 30, 50];

// movement speeds (tiles/s)
export const SPEED = {
  human: 4.2,
  zombiePlayer: 4.6,
  citizen: 2.2,
  citizenFlee: 3.2,
  zombieNpc: 1.2,
  zombieNpcChase: 3.0,
};
export const PLAYER_RADIUS = 0.35 * TILE;  // px
export const NPC_RADIUS = 0.32 * TILE;

// zombie melee (lunge)
export const LUNGE_RANGE = 0.9 * TILE;
export const LUNGE_CONE_COS = Math.cos((70 / 2) * Math.PI / 180);
export const LUNGE_COOLDOWN_TICKS = 20;     // 1.0s
export const LUNGE_IMPULSE = 2.0;           // extra tiles/s along aim
export const LUNGE_DURATION_TICKS = 3;      // 0.15s
export const INFECT_STUN_TICKS = 12;        // 0.6s
export const CURE_IMMUNE_TICKS = 40;        // 2s infect immunity after cure
export const NPC_CONTACT_INFECT_DIST = 0.45 * TILE; // zombie NPC touch radius (center dist)

// NPC AI
export const NPC_THINK_EVERY = 3;           // staggered thinking buckets
export const CITIZEN_FLEE_RADIUS = 6 * TILE;
export const CITIZEN_FLEE_EXIT_RADIUS = 9 * TILE;
export const CITIZEN_FLEE_EXIT_TICKS = 40;  // 2s without nearby zombie → calm down
export const ZNPC_AGGRO_RADIUS = 9 * TILE;
export const ZNPC_DEAGGRO_RADIUS = 13 * TILE;
export const ZNPC_LOSE_SIGHT_TICKS = 60;    // 3s invisible → de-aggro
export const ZNPC_ATTACK_RANGE = 0.8 * TILE;
export const ZNPC_ATTACK_COOLDOWN_TICKS = 20;
export const STUCK_CHECK_TICKS = 10;        // 0.5s displacement window
export const STUCK_MIN_DISP = 0.1 * TILE;
export const STUCK_DETOUR_TICKS = 12;       // 0.6s perpendicular detour
export const GRID_CELL = 128;               // spatial hash cell px (4 tiles)

// pistol
export const GUN_PICKUP_AMMO = 12;
export const AMMO_PICKUP = 8;
export const AMMO_CAP = 36;
export const VACCINE_CAP = 3;
export const BULLET_SPEED = 18;             // tiles/s
export const BULLET_RANGE = 12 * TILE;      // px
export const GUN_COOLDOWN_TICKS = 8;        // 0.4s
export const BULLET_HIT_RADIUS = 0.4 * TILE;
export const ZNPC_HP = 2;
export const ZPLAYER_HP = 4;
export const ZPLAYER_REGEN_TICKS = 200;     // +1 hp / 10s
export const ZPLAYER_REGEN_AFTER_HIT = 100; // only when 5s out of combat
export const GUN_KNOCKBACK = 0.3 * TILE;

// vaccine
export const VACCINE_RANGE = 1.2 * TILE;

// supply crates
export const CRATE_INTERVAL_TICKS = 5 * 60 * TICK_HZ;   // every 5:00
export const CRATE_5MIN_DROP_TICK = 150 * TICK_HZ;      // 5-min mode: single drop at 2:30
export const CRATE_FALL_TICKS = 40;                     // 2s drop animation
export const CRATE_PICKUP_RADIUS = 0.6 * TILE;
export const CRATE_MIN_DIST_CRATE = 8;   // tiles
export const CRATE_MIN_DIST_PLAYER = 6;  // tiles
// item weights per crate slot
export const CRATE_WEIGHTS = [['gun', 35], ['ammo', 30], ['vaccine', 35]];

// netcode
export const AOI_HALF = 800;             // px half-extent of interest box
export const AOI_MAX_NPCS = 64;
export const RECONNECT_GRACE_TICKS = 30 * TICK_HZ;  // 30s
export const INPUT_STALE_MS = 500;       // zero movement if no input this long
export const POS_QUANT = 4;              // position quantization: 1/4 px units

export const PEER_CONFIG = {
  // default PeerJS cloud; swap host/port/key here to self-host
  debug: 1,
  config: {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      { urls: 'turn:standard.relay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:standard.relay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    ],
  },
};

export function zombieCountFor(playerCount) {
  return playerCount <= 3 ? 1 : playerCount <= 6 ? 2 : 3;
}
