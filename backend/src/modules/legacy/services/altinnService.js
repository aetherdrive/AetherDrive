import { enqueueJob } from "./jobQueueService.js";

export function queueAmelding({ runId, companyId, period }) {
  return enqueueJob({ type: "amelding", payload: { runId, companyId, period } });
}
