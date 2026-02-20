/**
 * TaxProvider interface.
 * Implementations must be deterministic for a given input context.
 *
 * calculate({ run, gross, currency }) -> { provider, version, withholding_amount, basis }
 */
export class TaxProvider {
  constructor({ ruleset = null } = {}) {
    this.ruleset = ruleset;
  }
  async calculate(_ctx) {
    throw new Error("not_implemented");
  }
}
