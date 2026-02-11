// rules/norwayRules.js (ESM)
import { computeLines as baseComputeLines, round2 } from "./baseRules.js";

export const NORWAY_RULESET_VERSION = "no.v1";

export const DEFAULT_OVERTIME_MULTIPLIER = 1.4;
export const DEFAULT_NIGHT_ADDON_PER_HOUR = 0;

export function computeLinesNO({ entries, payRatesByEmployee = {}, policy = {} }) {
  const { lines, totals, warnings } = baseComputeLines({ entries, payRatesByEmployee });

  const nightAddon = Number(policy.night_addon_per_hour ?? DEFAULT_NIGHT_ADDON_PER_HOUR);
  if (nightAddon > 0) {
    for (const ln of lines) {
      if (ln?.meta?.tags?.includes?.("night")) {
        const addon = round2(ln.hours * nightAddon);
        ln.amount = round2(ln.amount + addon);
        totals.gross = round2(totals.gross + addon);
        ln.meta.night_addon = addon;
      }
    }
  }

  return { rule_set: "NO", rule_set_version: NORWAY_RULESET_VERSION, lines, totals, warnings };
}
