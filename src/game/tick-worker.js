// Wakeup clock for the host sim. Worker timers are exempt from background-tab
// throttling, so the sim keeps ticking when the host switches tabs.
// Messages are pure wakeups; all time math uses performance.now() on the main thread.
setInterval(() => postMessage(1), 25);
