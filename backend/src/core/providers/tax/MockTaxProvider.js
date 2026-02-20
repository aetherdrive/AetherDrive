import { TaxProvider } from "./TaxProvider.js";

export class MockTaxProvider extends TaxProvider {
  constructor({ ruleset = null } = {}) {
    super({ ruleset });
    this.provider = "mock";
    this.version = "1.0";
  }

  async calculate({ gross }) {
    const rate = Number(this.ruleset?.policy?.withholding_rate ?? this.ruleset?.withholding_rate ?? 0.25);
    const withholding = Math.round((Number(gross) || 0) * rate);
    return {
      provider: this.provider,
      version: this.version,
      withholding_amount: withholding,
      basis: { gross: Math.round(Number(gross) || 0), rate },
    };
  }
}
