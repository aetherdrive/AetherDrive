import fs from "fs";
import path from "path";
import crypto from "crypto";

const JOBS_PATH = path.resolve("data", "jobs.json");

function ensureFile() {
  try { fs.accessSync(JOBS_PATH); }
  catch {
    fs.mkdirSync(path.dirname(JOBS_PATH), { recursive: true });
    fs.writeFileSync(JOBS_PATH, "[]", "utf8");
  }
}
function readJobs(){ ensureFile(); return JSON.parse(fs.readFileSync(JOBS_PATH,"utf8")||"[]"); }
function writeJobs(jobs){ ensureFile(); fs.writeFileSync(JOBS_PATH, JSON.stringify(jobs,null,2),"utf8"); }

export function enqueueJob({ type, payload }) {
  const jobs = readJobs();
  const job = { id: crypto.randomUUID(), type, payload, status: "queued", attempts: 0, lastError: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  jobs.push(job); writeJobs(jobs); return job;
}
export function listJobs({ status }={}) {
  const jobs = readJobs();
  return status ? jobs.filter(j=>j.status===status) : jobs;
}
