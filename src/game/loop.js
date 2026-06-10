import { TICK_MS, INPUT_SEND_MS } from '../config.js';
import { stepSim } from '../core/sim.js';

/**
 * Host loop: fixed-timestep sim driven by a Worker clock (background-proof),
 * render on rAF with sim-interpolation alpha.
 */
export function startHostLoop({ sim, session, getSelfInput, onTick, render }) {
  const worker = new Worker(new URL('./tick-worker.js', import.meta.url), { type: 'module' });
  let last = performance.now();
  let acc = 0;
  let stopped = false;

  worker.onmessage = () => {
    if (stopped || sim.phase === 'ended') return;
    const now = performance.now();
    acc += now - last;
    last = now;
    let steps = 0;
    while (acc >= TICK_MS && steps < 5) {
      const selfP = sim.players[0];
      if (selfP) selfP.input = getSelfInput();
      session.collectInputs();
      const evs = stepSim(sim);
      onTick(evs);
      session.afterTick(evs);
      acc -= TICK_MS;
      steps++;
    }
    if (steps === 5) acc = 0; // shed surplus instead of spiraling
  };

  let raf = 0;
  const frame = () => {
    if (stopped) return;
    render(Math.min(1, acc / TICK_MS));
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    stopped = true;
    worker.terminate();
    cancelAnimationFrame(raf);
  };
}

/** Guest loop: rAF prediction+render, fixed-interval input send. */
export function startGuestLoop({ world, input, session, render }) {
  let stopped = false;
  let last = performance.now();
  let seq = 0;

  const iv = setInterval(() => {
    if (stopped) return;
    const f = input.frame();
    f.seq = seq = (seq + 1) & 0xffff;
    f.tick = world.tick;
    session.sendInput(f);
  }, INPUT_SEND_MS);

  let raf = 0;
  const frame = () => {
    if (stopped) return;
    const now = performance.now();
    const dt = Math.min(100, now - last);
    last = now;
    world.framePredict(input.frame(), dt, now);
    render(now);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    stopped = true;
    clearInterval(iv);
    cancelAnimationFrame(raf);
  };
}
