import { MockTaxProvider } from "../core/providers/tax/MockTaxProvider.js";

/**
 * Resolve providers from org capabilities.
 * capabilities example:
 * { tax_provider: "mock" }
 */
export function resolveTaxProvider(capabilities = {}, ruleset = null) {
  const name = String(capabilities?.tax_provider || "mock").toLowerCase();
  switch (name) {
    case "mock":
    default:
      return new MockTaxProvider({ ruleset });
  }
}
