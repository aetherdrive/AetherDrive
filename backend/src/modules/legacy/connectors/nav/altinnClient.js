// connectors/nav/altinnClient.js (ESM)
export class AltinnClient {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.baseUrl = process.env.ALTINN_BASE_URL || "https://platform.altinn.no";
  }

  async ping() {
    return { ok: true, baseUrl: this.baseUrl, note: "stub" };
  }

  async submitAMelding({ xmlOrJsonPayload, companyOrgNo }) {
    this.logger.info?.("[AltinnClient] submitAMelding stub called", { companyOrgNo });
    return { ok: false, error: "altinn_not_configured", hint: "Implement certificate/auth + correct endpoint + schema mapping" };
  }
}
