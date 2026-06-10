import Peer from 'peerjs';
import { PROTO_VERSION, PEER_CONFIG } from '../config.js';
import { MSG } from './protocol.js';
import { peerIdForCode } from './rooms.js';
import { encodeInput, decodeSnapshot, KIND } from './codec.js';

// Guest-side session. Two connections to the host: ctrl (reliable JSON) and
// state (unreliable binary). Falls back to ctrl-only if state never opens.

export class ClientSession {
  constructor({ code, name, look, callbacks }) {
    this.code = code;
    this.name = name;
    this.look = look;
    this.cb = callbacks;
    this.pid = -1;
    this.token = sessionStorage.getItem('zc-token-' + code) || null;
    this.peer = null;
    this.ctrl = null;
    this.state = null;
    this.stateOpen = false;
    this.degraded = false;
    this.phase = 'lobby';
    this.lastSnapSeq = -1;
    this.lastServerContact = performance.now();
    this.destroyed = false;
    this.reconnecting = false;
    this.retry = 0;
  }

  open() {
    const peer = new Peer(PEER_CONFIG);
    this.peer = peer;
    peer.on('open', () => this.connectToHost());
    peer.on('error', (err) => {
      if (this.destroyed) return;
      if (err.type === 'peer-unavailable') this.cb.onDeny?.('no-room');
      else if (!this.reconnecting && this.pid === -1) this.cb.onError?.('signal', err);
    });
  }

  connectToHost() {
    const hostId = peerIdForCode(this.code);
    const ctrl = this.peer.connect(hostId, { label: 'ctrl', serialization: 'json', reliable: true });
    this.ctrl = ctrl;
    ctrl.on('open', () => {
      this.retry = 0;
      ctrl.send({
        t: MSG.JOIN_REQ, proto: PROTO_VERSION, name: this.name, look: this.look,
        resumeToken: this.phase === 'playing' ? this.token : (this.token && this.reconnecting ? this.token : undefined),
      });
    });
    ctrl.on('data', (msg) => this.handleCtrl(msg));
    ctrl.on('close', () => this.handleLost());
    ctrl.on('error', () => this.handleLost());

    const state = this.peer.connect(hostId, { label: 'state', serialization: 'raw', reliable: false });
    this.state = state;
    state.on('open', () => {
      this.stateOpen = true;
      if (state.dataChannel) state.dataChannel.binaryType = 'arraybuffer';
    });
    state.on('data', (data) => this.handleStateData(data));
    state.on('close', () => { this.stateOpen = false; });
    setTimeout(() => {
      if (!this.stateOpen && !this.destroyed) this.degraded = true; // ctrl-only fallback
    }, 5000);
  }

  handleCtrl(msg) {
    if (!msg || typeof msg !== 'object') return;
    this.lastServerContact = performance.now();
    switch (msg.t) {
      case MSG.JOIN_ACK: {
        this.pid = msg.pid;
        this.token = msg.token;
        sessionStorage.setItem('zc-token-' + this.code, msg.token);
        const wasReconnect = this.reconnecting;
        this.reconnecting = false;
        if (wasReconnect && msg.resume) this.cb.onResumed?.(msg);
        else this.cb.onJoined?.(msg);
        break;
      }
      case MSG.JOIN_DENY:
        this.reconnecting = false;
        this.cb.onDeny?.(msg.reason);
        break;
      case MSG.ROSTER: this.cb.onRoster?.(msg.roster); break;
      case MSG.SETTINGS: this.cb.onSettings?.(msg.durationMin); break;
      case MSG.START:
        this.phase = 'playing';
        this.cb.onStart?.(msg);
        break;
      case MSG.EVENTS: this.cb.onEvents?.(msg.evs, msg.tick); break;
      case MSG.KEYFRAME: this.cb.onKeyframe?.(msg.state, msg.tick); break;
      case MSG.REMATCH:
        this.phase = 'lobby';
        this.cb.onRematch?.();
        break;
      case MSG.PONG: this.cb.onPong?.(msg.t0); break;
      case MSG.BYE:
        this.phase = 'ended';
        this.cb.onClosed?.();
        break;
      default: break;
    }
  }

  handleStateData(data) {
    const accept = (buf) => {
      if (buf.byteLength < 12) return;
      if (new DataView(buf).getUint8(0) !== KIND.SNAPSHOT) return;
      const snap = decodeSnapshot(buf);
      // drop stale/dup (u16 wraparound-aware)
      if (this.lastSnapSeq >= 0) {
        const diff = (snap.seq - this.lastSnapSeq) & 0xffff;
        if (diff === 0 || diff > 32768) return;
      }
      this.lastSnapSeq = snap.seq;
      this.lastServerContact = performance.now();
      this.cb.onSnapshot?.(snap);
    };
    if (data instanceof ArrayBuffer) accept(data);
    else if (ArrayBuffer.isView(data)) accept(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    else if (typeof Blob !== 'undefined' && data instanceof Blob) data.arrayBuffer().then(accept);
  }

  sendReady(ready) { this.sendCtrl({ t: MSG.READY, ready }); }
  sendLook(look) { this.look = look; this.sendCtrl({ t: MSG.LOOK, look }); }

  sendCtrl(msg) {
    if (this.ctrl && this.ctrl.open) {
      try { this.ctrl.send(msg); } catch { /* lost; close handler fires */ }
    }
  }

  sendInput(frame) {
    if (this.pid < 0) return;
    if (this.stateOpen && !this.degraded) {
      try { this.state.send(encodeInput(this.pid, frame)); return; } catch { /* fall through */ }
    }
    // ctrl fallback at reduced rate
    if ((frame.seq & 1) === 0) this.sendCtrl({ t: 'in', f: frame });
  }

  /** ms since last host contact — UI shows "호스트 대기 중" overlays off this. */
  silenceMs() {
    return performance.now() - this.lastServerContact;
  }

  handleLost() {
    if (this.destroyed) return;
    this.stateOpen = false;
    if (this.phase !== 'playing') {
      this.cb.onClosed?.();
      return;
    }
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.cb.onReconnecting?.();
    const attempt = () => {
      if (this.destroyed || !this.reconnecting) return;
      if (this.retry >= 4) {
        this.reconnecting = false;
        this.cb.onClosed?.();
        return;
      }
      const delay = [1000, 2000, 4000, 8000][this.retry++];
      setTimeout(() => {
        if (this.destroyed || !this.reconnecting) return;
        try {
          if (this.peer.destroyed) {
            this.peer = null;
            this.open();
          } else if (this.peer.disconnected) {
            this.peer.reconnect();
            this.connectToHost();
          } else {
            this.connectToHost();
          }
        } catch { /* retry below */ }
        setTimeout(() => { if (this.reconnecting) attempt(); }, 4000);
      }, delay);
    };
    attempt();
  }

  destroy() {
    this.destroyed = true;
    try { this.peer?.destroy(); } catch { /* already gone */ }
  }
}
