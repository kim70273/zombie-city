// Third-person input → InputFrame {moveX, moveY, buttons, aimDir}.
// Desktop: pointer-lock mouselook (yaw/pitch), WASD relative to camera, LMB action, E use.
// Mobile: dynamic left-zone joystick (camera-relative), right-zone drag look, DOM buttons.

import { BTN } from '../core/combat.js';

const PRIMARY = BTN.ATTACK | BTN.SHOOT; // sim role-gates which one applies

export class InputManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDown = false;
    this.useHeld = false;
    this.touchButtons = 0;
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    this.joy = null;        // {id, ox, oy, dx, dy}
    this.lookTouch = null;  // {id, x, y}
    this.yaw = 0;           // 2D world angle of the camera forward
    this.pitch = 0.3;
    this.locked = false;
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
    const lockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.mouseDown = false;
    };
    const mm = (e) => {
      if (!this.locked) return;
      this.yaw += e.movementX * 0.0030;
      this.pitch = Math.max(-0.12, Math.min(0.6, this.pitch + e.movementY * 0.0022));
    };
    const md = (e) => {
      if (this.isTouch || e.button !== 0) return;
      if (!this.locked) {
        if (e.target === this.canvas) this.canvas.requestPointerLock?.();
        return;
      }
      this.mouseDown = true;
    };
    const mu = (e) => { if (e.button === 0) this.mouseDown = false; };

    const ts = (e) => {
      const r = this.canvas.getBoundingClientRect();
      for (const t of e.changedTouches) {
        const x = t.clientX - r.left;
        if (!this.joy && x < r.width * 0.42) {
          this.joy = { id: t.identifier, ox: t.clientX, oy: t.clientY, dx: 0, dy: 0 };
          e.preventDefault();
        } else if (!this.lookTouch) {
          this.lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
          e.preventDefault();
        }
      }
    };
    const tm = (e) => {
      for (const t of e.changedTouches) {
        if (this.joy && t.identifier === this.joy.id) {
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
        } else if (this.lookTouch && t.identifier === this.lookTouch.id) {
          this.yaw += (t.clientX - this.lookTouch.x) * 0.0085;
          this.pitch = Math.max(-0.12, Math.min(0.6, this.pitch + (t.clientY - this.lookTouch.y) * 0.005));
          this.lookTouch.x = t.clientX;
          this.lookTouch.y = t.clientY;
          e.preventDefault();
        }
      }
    };
    const te = (e) => {
      for (const t of e.changedTouches) {
        if (this.joy && t.identifier === this.joy.id) this.joy = null;
        if (this.lookTouch && t.identifier === this.lookTouch.id) this.lookTouch = null;
      }
    };

    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    document.addEventListener('pointerlockchange', lockChange);
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
      document.removeEventListener('pointerlockchange', lockChange);
      window.removeEventListener('mousemove', mm);
      window.removeEventListener('mousedown', md);
      window.removeEventListener('mouseup', mu);
      this.canvas.removeEventListener('touchstart', ts);
      this.canvas.removeEventListener('touchmove', tm);
      this.canvas.removeEventListener('touchend', te);
      this.canvas.removeEventListener('touchcancel', te);
      if (this.locked) document.exitPointerLock?.();
    };
  }

  /** DOM action buttons (mobile) call this. */
  setButton(bit, on) {
    if (on) this.touchButtons |= bit;
    else this.touchButtons &= ~bit;
  }

  frame() {
    // local-space intent: f forward, s strafe-right
    let f = 0;
    let s = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
    if (this.joy) {
      f = -this.joy.dy; // push up = forward
      s = this.joy.dx;
    }
    // rotate into world space: forward=(cos yaw, sin yaw), right=(-sin yaw, cos yaw)
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    let mx = f * cy - s * sy;
    let my = f * sy + s * cy;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }

    let buttons = this.touchButtons;
    if (this.mouseDown || this.keys.has('Space')) buttons |= PRIMARY;
    if (this.useHeld) buttons |= BTN.USE;

    let a = this.yaw % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    const aimDir = Math.round((a / (Math.PI * 2)) * 256) & 255;

    return { moveX: mx, moveY: my, buttons, aimDir, seq: 0, tick: 0 };
  }
}
