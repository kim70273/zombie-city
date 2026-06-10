// Device-agnostic input → InputFrame {moveX, moveY, buttons, aimDir}.
// Desktop: WASD/arrows + mouse aim + LMB action + E use.
// Mobile: dynamic left-half joystick + DOM action buttons (wired via setButton).

import { BTN } from '../core/combat.js';

const PRIMARY = BTN.ATTACK | BTN.SHOOT; // sim role-gates which one applies

export class InputManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDown = false;
    this.useHeld = false;
    this.touchButtons = 0;
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    this.joy = null; // {id, ox, oy, dx, dy}
    this.lastAim = 0; // radians
    this.detach = null;
  }

  attach() {
    const kd = (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyE') this.useHeld = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    };
    const ku = (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyE') this.useHeld = false;
    };
    const mm = (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
    };
    const md = (e) => { if (e.button === 0 && e.target === this.canvas) this.mouseDown = true; };
    const mu = (e) => { if (e.button === 0) this.mouseDown = false; };

    const ts = (e) => {
      for (const t of e.changedTouches) {
        const r = this.canvas.getBoundingClientRect();
        const x = t.clientX - r.left;
        if (!this.joy && x < r.width * 0.45) {
          this.joy = { id: t.identifier, ox: t.clientX, oy: t.clientY, dx: 0, dy: 0 };
          e.preventDefault();
        }
      }
    };
    const tm = (e) => {
      if (!this.joy) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== this.joy.id) continue;
        const dx = t.clientX - this.joy.ox;
        const dy = t.clientY - this.joy.oy;
        const d = Math.hypot(dx, dy);
        const max = 56;
        const dead = 10;
        if (d < dead) { this.joy.dx = 0; this.joy.dy = 0; }
        else {
          const k = Math.min(1, d / max) / d;
          this.joy.dx = dx * k;
          this.joy.dy = dy * k;
        }
        e.preventDefault();
      }
    };
    const te = (e) => {
      if (!this.joy) return;
      for (const t of e.changedTouches) {
        if (t.identifier === this.joy.id) this.joy = null;
      }
    };

    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('mousemove', mm);
    window.addEventListener('mousedown', md);
    window.addEventListener('mouseup', mu);
    this.canvas.addEventListener('touchstart', ts, { passive: false });
    this.canvas.addEventListener('touchmove', tm, { passive: false });
    this.canvas.addEventListener('touchend', te);
    this.canvas.addEventListener('touchcancel', te);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.detach = () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('mousemove', mm);
      window.removeEventListener('mousedown', md);
      window.removeEventListener('mouseup', mu);
      this.canvas.removeEventListener('touchstart', ts);
      this.canvas.removeEventListener('touchmove', tm);
      this.canvas.removeEventListener('touchend', te);
      this.canvas.removeEventListener('touchcancel', te);
    };
  }

  /** DOM action buttons (mobile) call this. bit: BTN.* values, or PRIMARY. */
  setButton(bit, on) {
    if (on) this.touchButtons |= bit;
    else this.touchButtons &= ~bit;
  }

  frame() {
    let mx = 0;
    let my = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (this.joy) {
      mx = this.joy.dx;
      my = this.joy.dy;
    }
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }

    // aim: mouse relative to the canvas center (camera keeps self near center)
    if (!this.isTouch) {
      const cx = this.canvas.clientWidth / 2;
      const cy = this.canvas.clientHeight / 2;
      const adx = this.mouseX - cx;
      const ady = this.mouseY - cy;
      if (Math.hypot(adx, ady) > 8) this.lastAim = Math.atan2(ady, adx);
    } else if (len > 0.1) {
      this.lastAim = Math.atan2(my, mx);
    }

    let buttons = this.touchButtons;
    if (this.mouseDown || this.keys.has('Space')) buttons |= PRIMARY;
    if (this.useHeld) buttons |= BTN.USE;

    let a = this.lastAim;
    if (a < 0) a += Math.PI * 2;
    const aimDir = Math.round((a / (Math.PI * 2)) * 256) & 255;

    return { moveX: mx, moveY: my, buttons, aimDir, seq: 0, tick: 0 };
  }
}
