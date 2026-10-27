import { EventEmitter } from 'node:events';
import { resolveCheck, runCheck } from './checks.js';

const HISTORY = 30;

/** Runs each service's check on its own interval and keeps the latest results. */
export class Monitor extends EventEmitter {
  constructor() {
    super();
    this.entries = new Map(); // id -> { service, check, signature, timer, running, state }
  }

  sync(config) {
    const seen = new Set();
    for (const service of config.services) {
      seen.add(service.id);
      const check = resolveCheck(service, config.settings);
      const signature = JSON.stringify(check);
      const entry = this.entries.get(service.id);
      if (entry && entry.signature === signature) {
        entry.service = service;
        continue;
      }
      if (entry) clearTimeout(entry.timer);
      this.entries.set(service.id, {
        service,
        check,
        signature,
        timer: null,
        running: null,
        // Keep history across edits that only touch the check settings.
        state: { status: 'pending', latency: null, message: 'Checking…', checkedAt: null, history: entry?.state.history ?? [] },
      });
      this.run(service.id);
    }
    for (const [id, entry] of this.entries) {
      if (seen.has(id)) continue;
      clearTimeout(entry.timer);
      this.entries.delete(id);
    }
  }

  run(id) {
    const entry = this.entries.get(id);
    if (!entry) return Promise.resolve(null);
    if (entry.running) return entry.running;
    clearTimeout(entry.timer);
    entry.running = runCheck(entry.check).then((result) => {
      entry.running = null;
      if (this.entries.get(id) !== entry) return null; // replaced or removed mid-check
      const history = [...entry.state.history, { status: result.status, latency: result.latency, at: result.checkedAt }].slice(-HISTORY);
      entry.state = { ...result, history };
      if (entry.check.type !== 'none') entry.timer = setTimeout(() => this.run(id), entry.check.interval * 1000);
      this.emit('status', id, entry.state);
      return entry.state;
    });
    return entry.running;
  }

  async runAll() {
    await Promise.all([...this.entries.keys()].map((id) => this.run(id)));
    return this.snapshot();
  }

  snapshot() {
    return Object.fromEntries([...this.entries].map(([id, e]) => [id, e.state]));
  }
}
