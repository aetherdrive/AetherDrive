// connectors/banks/iso20022/pain001Builder.js (ESM)
export function buildPain001({ messageId, initiatingParty, payments = [], currency = "NOK" }) {
  return { type: "pain.001", messageId, initiatingParty, currency, payments };
}
