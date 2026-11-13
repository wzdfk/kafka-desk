/* Single EventSource connection for /api/stream.
 * Events (see server.js): status / log / kafka-messages / app-error,
 * each carrying a `serverId` so consumers can filter per server. */

let source = null;
let currentHandlers = null;

export function connectSse(handlers) {
  if (source) source.close();
  currentHandlers = handlers;
  source = new EventSource('/api/stream');

  const bind = (event, fn) => {
    source.addEventListener(event, (e) => {
      if (!fn) return;
      let data = null;
      try { data = JSON.parse(e.data); } catch { return; }
      fn(data);
    });
  };

  bind('status', handlers.onStatus);
  bind('log', handlers.onLog);
  bind('kafka-messages', handlers.onMessages);
  bind('app-error', handlers.onAppError);

  source.onopen = () => handlers.onOpen && handlers.onOpen();
  source.onerror = () => handlers.onError && handlers.onError(); // EventSource auto-reconnects
  return source;
}

/* Swap only the callbacks (used by stores that load later than the first connect). */
export function updateSseHandlers(partial) {
  if (!currentHandlers) return;
  Object.assign(currentHandlers, partial);
}

export function closeSse() {
  if (source) { source.close(); source = null; }
  currentHandlers = null;
}
