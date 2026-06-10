import './ui/style.css';
import { S } from './ui/strings.ko.js';
import { showHome, showLobby, showGameOverlay, showEnd, showModal, clearScreen } from './ui/screens.js';
import { HostSession } from './net/host.js';
import { ClientSession } from './net/client.js';
import { normalizeCode } from './net/rooms.js';
import { createSim, remainingMs } from './core/sim.js';
import { GuestWorld } from './game/gameClient.js';
import { startHostLoop, startGuestLoop } from './game/loop.js';
import { InputManager } from './game/input.js';
import { Renderer3D } from './render3d/renderer3d.js';
import { Hud } from './render/hud.js';
import { initAudio, play } from './audio/sfx.js';
import { EV } from './core/events.js';
import { TILE, TICK_HZ, VACCINE_RANGE } from './config.js';

const canvas = document.getElementById('game');
const hudCanvas = document.getElementById('hud');

function resizeHud() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  hudCanvas.width = Math.round(hudCanvas.clientWidth * dpr);
  hudCanvas.height = Math.round(hudCanvas.clientHeight * dpr);
  hudCanvas.__dpr = dpr;
}

const app = {
  mode: null, // 'host' | 'guest'
  host: null, client: null,
  sim: null, world: null,
  renderer: null, hud: null, input: null, overlay: null,
  stopLoop: null, lobby: null, home: null,
  guestRoster: [], guestDuration: 10,
  lastStep: 0, endShown: false, silentDead: false,
  wakeLock: null,
};

let prefName = localStorage.getItem('zc-name') || '';
let prefLook = +(localStorage.getItem('zc-look') || 0) % 8;

// ---------- boot ----------

function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {});
  }
  window.addEventListener('resize', () => {
    app.renderer?.resize();
    resizeHud();
  });
  goHome();
}

function joinCodeFromHash() {
  const m = location.hash.match(/#\/join\/([A-Za-z0-9]+)/i);
  return m ? normalizeCode(m[1]) : null;
}

function goHome() {
  cleanup();
  app.home = showHome({
    name: prefName,
    look: prefLook,
    joinCode: joinCodeFromHash(),
    onLookChange: (l) => { prefLook = l; localStorage.setItem('zc-look', String(l)); },
    onCreate: createRoom,
    onJoin: joinRoom,
  });
}

function savePrefs(name) {
  prefName = name;
  localStorage.setItem('zc-name', name);
}

// ---------- host flow ----------

function createRoom(name, look) {
  initAudio();
  savePrefs(name);
  app.mode = 'host';
  app.home.setBusy(true);
  app.host = new HostSession({
    name, look,
    callbacks: {
      onRoomReady: () => showLobbyScreen(),
      onRosterChange: () => updateLobby(),
      onSettings: () => updateLobby(),
      onError: (kind) => {
        if (kind === 'signal') { showModal(S.errSignal, goHome); }
      },
    },
  });
  app.host.open();
}

function startHostGame() {
  const payload = app.host.buildStart();
  app.sim = createSim(
    { mapSeed: payload.mapSeed, roleSeed: payload.roleSeed, durationMin: payload.durationMin },
    payload.roster
  );
  app.host.attachSim(app.sim);
  enterGame(app.sim.map);
  app.stopLoop = startHostLoop({
    sim: app.sim,
    session: app.host,
    getSelfInput: () => app.input.frame(),
    onTick: (evs) => handleEvents(evs),
    render: (alpha) => renderHost(alpha),
  });
}

// ---------- guest flow ----------

function joinRoom(codeRaw, name, look) {
  const code = normalizeCode(codeRaw);
  if (!code) { showModal(S.errNoRoom); return; }
  initAudio();
  savePrefs(name);
  app.mode = 'guest';
  app.home.setBusy(true);
  app.client = new ClientSession({
    code, name, look,
    callbacks: {
      onJoined: (msg) => {
        app.guestRoster = msg.roster;
        app.guestDuration = msg.settings.durationMin;
        showLobbyScreen();
      },
      onResumed: (msg) => {
        // page kept alive: world still exists; clear the banner
        if (msg.resume && !app.world) startGuestGame(msg.resume);
        app.overlay?.banner(null);
      },
      onDeny: (reason) => {
        const text = { full: S.errFull, started: S.errStarted, version: S.errVersion, 'no-room': S.errNoRoom }[reason] || S.errConn;
        showModal(text, goHome);
      },
      onRoster: (roster) => { app.guestRoster = roster; updateLobby(); },
      onSettings: (min) => { app.guestDuration = min; updateLobby(); },
      onStart: (payload) => startGuestGame(payload),
      onEvents: (evs) => {
        app.world?.applyEvents(evs);
        handleEvents(evs);
      },
      onKeyframe: (state) => app.world?.applyKeyframe(state),
      onSnapshot: (snap) => app.world?.applySnapshot(snap),
      onRematch: () => {
        teardownGame();
        showLobbyScreen();
      },
      onReconnecting: () => app.overlay?.banner(S.reconnecting),
      onClosed: () => {
        if (app.endShown) return;
        const inGame = !!app.world;
        showModal(inGame ? S.errHostGone : S.roomClosed, goHome);
      },
      onError: () => showModal(S.errSignal, goHome),
    },
  });
  app.client.open();
}

function startGuestGame(payload) {
  app.world = new GuestWorld(payload, app.client.pid);
  enterGame(app.world.map);
  app.stopLoop = startGuestLoop({
    world: app.world,
    input: app.input,
    session: app.client,
    render: (now) => renderGuest(now),
  });
}

// ---------- lobby ----------

function showLobbyScreen() {
  app.endShown = false;
  const isHost = app.mode === 'host';
  const code = isHost ? app.host.code : app.client.code;
  const shareUrl = location.origin + location.pathname + '#/join/' + code;
  app.lobby = showLobby({
    isHost, code, shareUrl,
    onDuration: (m) => { if (isHost) app.host.setDuration(m); },
    onStart: () => startHostGame(),
    onReady: (r) => app.client?.sendReady(r),
    onLeave: () => goHome(),
    onLookCycle: () => {
      prefLook = (prefLook + 1) % 8;
      localStorage.setItem('zc-look', String(prefLook));
      if (isHost) app.host.setHostLook(prefLook);
      else app.client.sendLook(prefLook);
    },
    onAddBot: () => app.host?.addBot(),
    onRemoveBot: (pid) => app.host?.removeBot(pid),
  });
  updateLobby();
}

function updateLobby() {
  if (!app.lobby) return;
  const isHost = app.mode === 'host';
  app.lobby.update({
    roster: isHost ? app.host.publicRoster() : app.guestRoster,
    durationMin: isHost ? app.host.durationMin : app.guestDuration,
    selfPid: isHost ? 0 : app.client?.pid,
    canStart: isHost ? app.host.canStart() : false,
  });
}

// ---------- game ----------

function enterGame(map) {
  app.lobby = null;
  app.input = new InputManager(canvas);
  app.input.attach();
  app.renderer = new Renderer3D(canvas, map);
  app.hud = new Hud(map, app.input.isTouch);
  resizeHud();
  app.overlay = showGameOverlay({ isTouch: app.input.isTouch, input: app.input });
  app.endShown = false;
  app.silentDead = false;
  if (navigator.wakeLock) {
    navigator.wakeLock.request('screen').then((wl) => { app.wakeLock = wl; }).catch(() => {});
  }
}

function teardownGame() {
  app.stopLoop?.();
  app.stopLoop = null;
  app.input?.detach?.();
  app.input = null;
  app.renderer?.dispose?.();
  app.renderer = null;
  hudCanvas.getContext('2d')?.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
  app.hud = null;
  app.overlay = null;
  app.sim = null;
  app.world = null;
  app.wakeLock?.release?.().catch(() => {});
  app.wakeLock = null;
  clearScreen();
}

function selfPid() {
  return app.mode === 'host' ? 0 : app.client?.pid ?? -1;
}

// ---------- event → effect/sfx/feed routing ----------

function handleEvents(evs) {
  const now = performance.now();
  const fx = app.renderer?.effects;
  if (!fx) return;
  const pos = (e) => {
    if (e.pid !== undefined || e.victim !== undefined) {
      const pid = e.victim ?? e.pid;
      const p = app.mode === 'host' ? app.sim?.players[pid] : app.world?.players.get(pid);
      return p ? { x: p.x, y: p.y } : null;
    }
    if (e.id !== undefined) {
      const n = app.mode === 'host' ? app.sim?.npcs[e.id] : app.world?.npcs.get(e.id);
      return n ? { x: n.x, y: n.y } : null;
    }
    return null;
  };
  const nameOf = (by) => {
    if (typeof by !== 'number') return null;
    const p = app.mode === 'host' ? app.sim?.players[by] : app.world?.players.get(by);
    return p?.name ?? null;
  };
  const gainFor = (p) => {
    if (!p || !app.renderer) return 0.6;
    const d = Math.hypot(p.x - app.renderer.camX, p.y - app.renderer.camY);
    return Math.max(0, 1 - d / (16 * TILE));
  };

  for (const e of evs) {
    switch (e.t) {
      case EV.LUNGE: {
        app.renderer.triggerAttack('p' + e.pid, now);
        const p = pos(e);
        if (p) play('lunge', { gain: gainFor(p) });
        break;
      }
      case EV.SHOT: {
        fx.spawn('muzzle', e.x + e.dx * 18, e.y + e.dy * 18, { h: 26 });
        play('gunshot', { gain: gainFor(e) });
        break;
      }
      case EV.HIT: {
        const p = pos({ [e.kind === 'p' ? 'pid' : 'id']: e.id });
        if (p) { fx.spawn('hit', p.x, p.y); play('hit', { gain: gainFor(p) }); }
        break;
      }
      case EV.PLAYER_INFECTED: {
        const p = pos(e);
        if (p) fx.spawn('infect', p.x, p.y);
        play('infect', { gain: e.victim === selfPid() ? 1 : 0.7 });
        const byName = nameOf(e.by);
        app.overlay?.feed(byName ? S.feedInfectedBy(byName, nameOf(e.victim) || '?') : S.feedInfected(nameOf(e.victim) || '?'));
        break;
      }
      case EV.NPC_INFECTED: {
        const p = pos(e);
        if (p) { fx.spawn('infect', p.x, p.y); play('infect', { gain: gainFor(p) * 0.5 }); }
        break;
      }
      case EV.PLAYER_CURED: {
        const p = pos(e);
        if (p) fx.spawn('cure', p.x, p.y);
        play('cure');
        app.overlay?.feed(S.feedCured(nameOf(e.pid) || '?'));
        break;
      }
      case EV.NPC_CURED: {
        const p = pos(e);
        if (p) { fx.spawn('cure', p.x, p.y); play('cure', { gain: gainFor(p) * 0.6 }); }
        break;
      }
      case EV.PLAYER_KILLED: {
        const p = pos(e);
        if (p) fx.spawn('death', p.x, p.y);
        app.overlay?.feed(S.feedKilled(nameOf(e.pid) || '?'));
        break;
      }
      case EV.NPC_KILLED: {
        const p = pos(e);
        if (p) fx.spawn('death', p.x, p.y);
        break;
      }
      case EV.SCREAM: {
        const p = pos(e);
        if (p) { fx.spawn('scream', p.x, p.y); play('scream', { gain: gainFor(p) * 0.7 }); }
        break;
      }
      case EV.CRATE_INCOMING:
        app.overlay?.toast(S.feedCrate);
        app.overlay?.feed(S.feedCrate);
        break;
      case EV.CRATE_LANDED:
        play('crateLand', { gain: 0.7 });
        break;
      case EV.ITEM_PICKED:
        play('pickup', { gain: e.pid === selfPid() ? 1 : 0.4 });
        break;
      case EV.MATCH_END:
        onMatchEnd(e);
        break;
      default:
        break;
    }
  }
}

function onMatchEnd(e) {
  if (app.endShown) return;
  app.endShown = true;
  const me = e.stats.find((s) => s.pid === selfPid());
  const myTeamWon = e.winner === 'zombie' ? !!me?.isZombie : !me?.isZombie;
  play(myTeamWon ? 'victory' : 'defeat');
  setTimeout(() => {
    teardownGame();
    showEnd({
      winner: e.winner,
      stats: e.stats,
      selfPid: selfPid(),
      isHost: app.mode === 'host',
      onRematch: () => {
        app.host.rematch();
        showLobbyScreen();
      },
      onLeave: () => goHome(),
    });
  }, 1800);
}

// ---------- render drivers ----------

function renderHost(alpha) {
  const sim = app.sim;
  if (!sim || !app.renderer) return;
  const now = performance.now();
  const lp = (e) => ({ x: e.prevX + (e.x - e.prevX) * Math.min(1, alpha) || e.x, y: e.prevY + (e.y - e.prevY) * Math.min(1, alpha) || e.y });
  const players = [];
  for (const p of sim.players) {
    if (!p) continue;
    const l = p.prevX ? lp(p) : p;
    players.push({
      pid: p.pid, name: p.name, look: p.look, x: l.x, y: l.y, facing: p.facing,
      yaw: (p.input?.aimDir ?? 0) & 0xff,
      isZombie: p.isZombie, alive: p.alive, hasGun: p.hasGun,
      ammo: p.ammo, vaccines: p.vaccines, hp: p.hp,
      stunned: sim.tick < p.stunUntil, connected: p.connected, removed: p.removedAtTick !== null,
    });
  }
  const npcs = [];
  for (const n of sim.npcs) {
    if (!n.alive) continue;
    const l = n.prevX ? lp(n) : n;
    npcs.push({ id: n.id, look: n.look, x: l.x, y: l.y, facing: n.facing, isZombie: n.isZombie, alive: true });
  }
  const view = {
    players, npcs,
    crates: sim.crates.map((c) => ({ id: c.id, x: c.x, y: c.y, items: c.items, ticksToLand: Math.max(0, c.landTick - sim.tick) })),
    projectiles: sim.projectiles,
    phase: sim.phase,
  };
  drawFrame(view, remainingMs(sim), Math.ceil(Math.max(0, sim.startTick - sim.tick) / TICK_HZ), now);
}

function renderGuest(now) {
  const world = app.world;
  if (!world || !app.renderer) return;
  const view = world.sample(now);
  const countdownLeft = Math.ceil(Math.max(0, (world.shadow.startTick - world.tick)) / TICK_HZ);
  drawFrame(view, world.hudRemainingMs(now), countdownLeft, now);

  // host-silence overlays
  const silence = app.client.silenceMs();
  if (view.phase === 'playing') {
    if (silence > 3000) app.overlay?.banner(S.hostWaiting);
    else if (!app.client.reconnecting) app.overlay?.banner(null);
    if (silence > 15000 && !app.silentDead && !app.endShown) {
      app.silentDead = true;
      showModal(S.errHostGone, goHome);
    }
  }
}

function drawFrame(view, remMs, countdownLeft, now) {
  const me = view.players.find((p) => p.pid === selfPid());
  let cam = me && me.alive ? { x: me.x, y: me.y } : null;
  if (!cam) {
    const follow = view.players.find((p) => p.alive && !p.removed);
    cam = follow ? { x: follow.x, y: follow.y } : { x: 0, y: 0 };
  }
  cam.yaw = app.input.yaw;
  cam.pitch = app.input.pitch;
  app.renderer.draw(view, cam, now, selfPid());

  // footsteps for the local player
  if (me && me.alive) {
    const a = app.renderer.anim.get('p' + me.pid);
    if (a?.moving && now - app.lastStep > 280) {
      app.lastStep = now;
      play('footstep');
    }
  }

  // vaccine hint: holding a vaccine with a zombie in range
  let vaccineHint = false;
  if (me && me.alive && !me.isZombie && me.vaccines > 0) {
    const r = VACCINE_RANGE * 1.5;
    vaccineHint =
      view.players.some((p) => p.alive && p.isZombie && Math.hypot(p.x - me.x, p.y - me.y) < r) ||
      view.npcs.some((n) => n.isZombie && Math.hypot(n.x - me.x, n.y - me.y) < r);
  }

  const dpr = hudCanvas.__dpr || 1;
  const ctx = hudCanvas.getContext('2d');
  const vw = hudCanvas.width / dpr;
  const vh = hudCanvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, vw, vh);
  app.hud.draw(ctx, vw, vh, {
    remainingMs: remMs,
    players: view.players,
    npcs: view.npcs,
    crates: view.crates,
    selfPid: selfPid(),
    camX: cam.x, camY: cam.y,
    phase: view.phase,
    countdownLeft,
    spectating: !!(me && !me.alive),
    vaccineHint,
  }, now);

  // crosshair (third-person aim = camera center)
  if (me && me.alive && view.phase === 'playing') {
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    const cx = vw / 2;
    const cyy = vh / 2;
    ctx.beginPath();
    ctx.arc(cx, cyy, 3, 0, Math.PI * 2);
    ctx.stroke();
    for (const [dx, dy] of [[8, 0], [-8, 0], [0, 8], [0, -8]]) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * 0.6, cyy + dy * 0.6);
      ctx.lineTo(cx + dx * 1.6, cyy + dy * 1.6);
      ctx.stroke();
    }
  }
  // pointer-lock hint (desktop)
  if (!app.input.isTouch && !app.input.locked && view.phase === 'playing') {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.font = 'bold 14px sans-serif';
    const msg = '화면을 클릭하면 마우스로 시점을 조작할 수 있어요 (ESC로 해제)';
    const tw = ctx.measureText(msg).width + 26;
    ctx.beginPath();
    ctx.roundRect(vw / 2 - tw / 2, vh - 110, tw, 30, 9);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(msg, vw / 2, vh - 90);
  }
}

// ---------- cleanup ----------

function cleanup() {
  teardownGame();
  app.host?.destroy();
  app.client?.destroy();
  app.host = null;
  app.client = null;
  app.mode = null;
  app.guestRoster = [];
  app.lobby = null;
}

boot();

// debug/E2E hook
window.__zc = app;
