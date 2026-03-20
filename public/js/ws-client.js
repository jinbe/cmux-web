/**
 * WebSocket client for moravec.
 * Manages connection, reconnection, and message routing.
 */

export class WsClient {
  /** @type {WebSocket | null} */
  #ws = null;
  /** @type {Map<string, { resolve: Function, reject: Function, timer: number }>} */
  #pending = new Map();
  /** @type {Map<string, Function[]>} */
  #listeners = new Map();
  /** @type {string} */
  #url;
  /** @type {boolean} */
  #connected = false;
  /** @type {number | null} */
  #reconnectTimer = null;

  static REQUEST_TIMEOUT_MS = 5000;
  static RECONNECT_DELAY_MS = 2000;

  constructor() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    this.#url = `${proto}//${location.host}/ws`;
  }

  /** Connect to the server. Returns a promise that resolves on first successful connection. */
  connect() {
    return new Promise((resolve, reject) => {
      this.#ws = new WebSocket(this.#url);

      this.#ws.onopen = () => {
        this.#connected = true;
        console.log("[moravec] WebSocket connected");
        resolve();
      };

      this.#ws.onmessage = (event) => {
        this.#handleMessage(event.data);
      };

      this.#ws.onclose = () => {
        this.#connected = false;
        console.log("[moravec] WebSocket disconnected, reconnecting...");
        this.#scheduleReconnect();
      };

      this.#ws.onerror = (err) => {
        console.error("[moravec] WebSocket error:", err);
        if (!this.#connected) reject(err);
      };
    });
  }

  /** Send a request and wait for a response. */
  request(type, params = {}) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const msg = { type, id, params };

      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Request timed out: ${type}`));
      }, WsClient.REQUEST_TIMEOUT_MS);

      this.#pending.set(id, { resolve, reject, timer });

      this.#ws?.send(JSON.stringify(msg));
    });
  }

  /** Send a fire-and-forget message (e.g. terminal input). */
  send(type, params = {}) {
    const id = crypto.randomUUID();
    const msg = { type, id, params };
    this.#ws?.send(JSON.stringify(msg));
  }

  /** Subscribe to a message type. */
  on(type, callback) {
    if (!this.#listeners.has(type)) {
      this.#listeners.set(type, []);
    }
    this.#listeners.get(type).push(callback);
  }

  /** Remove a subscription. */
  off(type, callback) {
    const listeners = this.#listeners.get(type);
    if (listeners) {
      const idx = listeners.indexOf(callback);
      if (idx !== -1) listeners.splice(idx, 1);
    }
  }

  get connected() {
    return this.#connected;
  }

  // --- Internals ---

  #handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Response to a pending request
    if (msg.type === "response" && msg.id) {
      const pending = this.#pending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.#pending.delete(msg.id);
        if (msg.ok) {
          pending.resolve(msg.result);
        } else {
          pending.reject(new Error(msg.error?.message ?? "Unknown error"));
        }
        return;
      }
    }

    // Broadcast to listeners
    const listeners = this.#listeners.get(msg.type) ?? [];
    for (const cb of listeners) {
      try {
        cb(msg);
      } catch (err) {
        console.error("[moravec] Listener error:", err);
      }
    }
  }

  #scheduleReconnect() {
    if (this.#reconnectTimer) return;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.connect().catch(() => {
        // Will retry via onclose
      });
    }, WsClient.RECONNECT_DELAY_MS);
  }
}
