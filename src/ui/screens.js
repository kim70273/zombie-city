import { S } from './strings.ko.js';
import { DURATION_CHOICES, MAX_PLAYERS } from '../config.js';
import { zombieCountFor } from '../core/rules.js';
import { getAtlas } from '../render/chars.js';
import { BTN } from '../core/combat.js';

// DOM screens & in-game overlay. One root, one active screen at a time.

const root = () => document.getElementById('ui-root');

export function clearScreen() {
  root().innerHTML = '';
  stopPreviews();
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// --- animated character previews (lobby/home) ---
let previewRaf = 0;
const previews = new Set(); // {canvas, getLook, zombie}

function startPreviews() {
  if (previewRaf) return;
  const tick = (now) => {
    for (const p of previews) {
      const ctx = p.canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, p.canvas.width, p.canvas.height);
      const atlas = getAtlas(p.getLook(), p.zombie || false, false);
      const col = Math.floor(now / 220) % 4;
      const f = atlas.frame(0, col);
      ctx.drawImage(atlas.canvas, f.sx, f.sy, f.sw, f.sh, 0, 0, p.canvas.width, p.canvas.height);
    }
    previewRaf = requestAnimationFrame(tick);
  };
  previewRaf = requestAnimationFrame(tick);
}

function stopPreviews() {
  previews.clear();
  cancelAnimationFrame(previewRaf);
  previewRaf = 0;
}

function addPreview(canvas, getLook, zombie = false) {
  canvas.width = 64;
  canvas.height = 80;
  previews.add({ canvas, getLook, zombie });
  startPreviews();
}

// ---------- home ----------

export function showHome({ name, look, joinCode, onCreate, onJoin, onLookChange }) {
  clearScreen();
  const screen = el('div', 'screen');
  const card = el('div', 'card');

  card.appendChild(el('h1', 'logo', S.title));
  card.appendChild(el('div', 'subtitle', S.subtitle));

  const picker = el('div', 'look-picker');
  const left = el('button', 'arrow-btn', '◀');
  const right = el('button', 'arrow-btn', '▶');
  const pv = document.createElement('canvas');
  let curLook = look;
  addPreview(pv, () => curLook);
  left.onclick = () => { curLook = (curLook + 7) % 8; onLookChange(curLook); };
  right.onclick = () => { curLook = (curLook + 1) % 8; onLookChange(curLook); };
  picker.append(left, pv, right);
  card.appendChild(picker);

  const nameInput = el('input');
  nameInput.type = 'text';
  nameInput.maxLength = 12;
  nameInput.placeholder = S.nicknamePh;
  nameInput.value = name;
  card.appendChild(nameInput);

  const createBtn = el('button', '', S.createRoom);
  createBtn.onclick = () => onCreate(nameInput.value.trim() || '플레이어', curLook);
  card.appendChild(createBtn);

  card.appendChild(el('div', 'divider', S.or));

  const codeInput = el('input', 'code');
  codeInput.type = 'text';
  codeInput.maxLength = 5;
  codeInput.placeholder = S.codePh;
  if (joinCode) codeInput.value = joinCode;
  const joinBtn = el('button', 'secondary', S.joinRoom);
  joinBtn.onclick = () => onJoin(codeInput.value, nameInput.value.trim() || '플레이어', curLook);
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinBtn.click(); });
  card.append(codeInput, joinBtn);

  screen.appendChild(card);
  root().appendChild(screen);
  return { setBusy(b) { createBtn.disabled = joinBtn.disabled = b; createBtn.textContent = b ? S.connecting : S.createRoom; } };
}

// ---------- lobby ----------

export function showLobby({ isHost, code, shareUrl, onDuration, onStart, onReady, onLeave, onLookCycle, onAddBot, onRemoveBot }) {
  clearScreen();
  const screen = el('div', 'screen');
  const card = el('div', 'card wide');

  card.appendChild(el('div', 'hint', S.roomCode));
  const codeEl = el('div', 'room-code', code);
  card.appendChild(codeEl);

  const shareRow = el('div', 'row');
  const copyBtn = el('button', 'secondary small', S.copy);
  copyBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(code); copyBtn.textContent = S.copied; } catch { /* http ctx */ }
    setTimeout(() => { copyBtn.textContent = S.copy; }, 1200);
  };
  const linkBtn = el('button', 'secondary small', S.copyLink);
  linkBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(shareUrl); linkBtn.textContent = S.copied; } catch { /* http ctx */ }
    setTimeout(() => { linkBtn.textContent = S.copyLink; }, 1200);
  };
  shareRow.append(copyBtn, linkBtn);
  card.appendChild(shareRow);
  card.appendChild(el('div', 'hint', S.shareHint));

  const grid = el('div', 'player-grid');
  card.appendChild(grid);
  const countHint = el('div', 'hint', '');
  card.appendChild(countHint);

  let addBotBtn = null;
  if (isHost) {
    addBotBtn = el('button', 'secondary small', S.addBot);
    addBotBtn.onclick = () => onAddBot?.();
    const botRow = el('div', 'row');
    botRow.appendChild(addBotBtn);
    card.appendChild(botRow);
  }

  card.appendChild(el('div', 'hint', S.duration + ' (시간이 길수록 맵이 커져요)'));
  const durRow = el('div', 'duration-row');
  const durBtns = new Map();
  for (const m of DURATION_CHOICES) {
    const b = el('button', '', S.minutes(m));
    b.disabled = !isHost;
    b.onclick = () => onDuration(m);
    durBtns.set(m, b);
    durRow.appendChild(b);
  }
  card.appendChild(durRow);

  const actionRow = el('div', 'row');
  let mainBtn;
  if (isHost) {
    mainBtn = el('button', '', S.start);
    mainBtn.onclick = onStart;
  } else {
    mainBtn = el('button', '', S.ready);
    let ready = false;
    mainBtn.onclick = () => {
      ready = !ready;
      mainBtn.textContent = ready ? S.readyDone : S.ready;
      mainBtn.classList.toggle('secondary', ready);
      onReady(ready);
    };
  }
  const leaveBtn = el('button', 'danger', S.leave);
  leaveBtn.onclick = onLeave;
  actionRow.append(mainBtn, leaveBtn);
  card.appendChild(actionRow);

  screen.appendChild(card);
  root().appendChild(screen);

  return {
    update({ roster, durationMin, selfPid, canStart }) {
      // duration highlight
      for (const [m, b] of durBtns) b.classList.toggle('active', m === durationMin);
      // player grid
      previews.clear();
      grid.innerHTML = '';
      for (let i = 0; i < MAX_PLAYERS; i++) {
        const r = roster[i];
        if (!r) {
          const slot = el('div', 'player-slot empty', '비어 있음');
          grid.appendChild(slot);
          continue;
        }
        const slot = el('div', 'player-slot' + (r.pid === selfPid ? ' me' : ''));
        if (r.isHost) slot.appendChild(el('div', 'crown', '👑'));
        const pv = document.createElement('canvas');
        addPreview(pv, () => r.look);
        slot.appendChild(pv);
        slot.appendChild(el('div', 'pname', r.name));
        slot.appendChild(el('div', 'badge',
          r.isHost ? S.host : r.isBot ? S.bot : r.ready ? S.readyDone : (r.connected === false ? '연결 끊김' : '')));
        if (r.pid === selfPid) {
          slot.title = S.tapToChangeLook;
          slot.onclick = () => onLookCycle();
        }
        if (r.isBot && isHost) {
          const rm = el('button', 'danger small bot-remove', '✕');
          rm.onclick = (e) => { e.stopPropagation(); onRemoveBot?.(r.pid); };
          slot.appendChild(rm);
        }
        grid.appendChild(slot);
      }
      countHint.textContent = `${roster.length} / ${MAX_PLAYERS}명 · ${S.zombiePick(zombieCountFor(Math.max(2, roster.length)))}`;
      if (isHost) {
        mainBtn.disabled = !canStart;
        mainBtn.textContent = roster.length < 2 ? S.needPlayers : canStart ? S.start : S.needReady;
      }
    },
  };
}

// ---------- in-game overlay ----------

export function showGameOverlay({ isTouch, input }) {
  clearScreen();
  const wrap = el('div');
  wrap.id = 'game-overlay';
  const feed = el('div');
  feed.id = 'feed';
  wrap.appendChild(feed);
  root().appendChild(wrap);

  if (isTouch && input) {
    const tc = el('div');
    tc.id = 'touch-controls';
    const atk = el('div', 'tbtn', S.touchAttack);
    atk.id = 'btn-attack';
    const use = el('div', 'tbtn', '💉');
    use.id = 'btn-use';
    bindHold(atk, (on) => input.setButton(BTN.ATTACK | BTN.SHOOT, on));
    bindHold(use, (on) => input.setButton(BTN.USE, on));
    tc.append(use, atk);
    wrap.appendChild(tc);
  }

  let toastEl = null;
  let toastTimer = 0;
  let bannerEl = null;

  return {
    feed(text) {
      const d = el('div', '', text);
      feed.appendChild(d);
      while (feed.children.length > 4) feed.removeChild(feed.firstChild);
      setTimeout(() => d.classList.add('fading'), 6000);
      setTimeout(() => d.remove(), 8000);
    },
    toast(text, ms = 2500) {
      if (toastEl) toastEl.remove();
      toastEl = el('div', '', text);
      toastEl.id = 'toast';
      wrap.appendChild(toastEl);
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toastEl?.remove(); toastEl = null; }, ms);
    },
    banner(text) {
      if (!text) { bannerEl?.remove(); bannerEl = null; return; }
      if (!bannerEl) {
        bannerEl = el('div');
        bannerEl.id = 'banner';
        wrap.appendChild(bannerEl);
      }
      bannerEl.textContent = text;
    },
  };
}

function bindHold(elem, set) {
  const on = (e) => { e.preventDefault(); set(true); };
  const off = (e) => { e.preventDefault(); set(false); };
  elem.addEventListener('touchstart', on, { passive: false });
  elem.addEventListener('touchend', off);
  elem.addEventListener('touchcancel', off);
  elem.addEventListener('mousedown', on);
  elem.addEventListener('mouseup', off);
}

// ---------- end screen ----------

export function showEnd({ winner, stats, selfPid, isHost, onRematch, onLeave }) {
  clearScreen();
  const screen = el('div', 'screen');
  const card = el('div', 'card wide');

  const title = winner === 'human' ? S.humanWin : winner === 'zombie' ? S.zombieWin : S.aborted;
  const t = el('div', `win-title ${winner}`, title);
  card.appendChild(t);

  if (stats && stats.length) {
    const table = el('table', 'stats');
    const head = el('tr');
    for (const h of ['', S.statName, S.statInfections, S.statKills, S.statCures, S.statSurvived]) {
      head.appendChild(el('th', '', h));
    }
    table.appendChild(head);
    for (const st of stats) {
      const tr = el('tr', st.pid === selfPid ? 'me' : '');
      tr.appendChild(el('td', '', st.isZombie ? '🧟' : st.alive ? '🧑' : '💀'));
      tr.appendChild(el('td', '', st.name));
      tr.appendChild(el('td', '', String(st.infections)));
      tr.appendChild(el('td', '', String(st.kills)));
      tr.appendChild(el('td', '', String(st.cures)));
      tr.appendChild(el('td', '', `${Math.floor(st.survivedSec / 60)}:${String(st.survivedSec % 60).padStart(2, '0')}`));
      table.appendChild(tr);
    }
    card.appendChild(table);
  }

  const row = el('div', 'row');
  if (isHost) {
    const re = el('button', '', S.rematch);
    re.onclick = onRematch;
    row.appendChild(re);
  } else {
    card.appendChild(el('div', 'hint', S.waitRematch));
  }
  const lv = el('button', 'secondary', S.leave);
  lv.onclick = onLeave;
  row.appendChild(lv);
  card.appendChild(row);

  screen.appendChild(card);
  root().appendChild(screen);
}

// ---------- modal ----------

export function showModal(text, onOk) {
  const back = el('div', 'modal-backdrop');
  const card = el('div', 'card');
  card.appendChild(el('div', 'subtitle', text));
  const b = el('button', '', S.ok);
  b.onclick = () => { back.remove(); onOk?.(); };
  card.appendChild(b);
  back.appendChild(card);
  root().appendChild(back);
}
