// baseConnector.js
export class BaseTimebankConnector {
  constructor({ provider, http = null, logger = console } = {}) {
    if (!provider) throw new Error("provider required");
    this.provider = provider;
    this.http = http;
    this.logger = logger;
  }
  async fetchApprovedTimes() { throw new Error("Not implemented"); }
  async parseWebhook() { throw new Error("Not implemented"); }
  async writeBack() { return { ok: true }; }
  normalizeEntry(e) {
    return {
      employee_id: String(e.employee_id),
      date: e.date,
      start: e.start,
      end: e.end,
      break_minutes: Number(e.break_minutes || 0),
      source: this.provider
    };
  }
}
