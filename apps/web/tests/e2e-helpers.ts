import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const database = process.env.E2E_DATABASE_NAME || "";
const suffix = database.match(/^fluxapi_e2e_phase7_([a-f0-9]{12})$/)?.[1];
const apiOrigin = process.env.E2E_API_ORIGIN || "";

if (!suffix || apiOrigin !== "http://127.0.0.1:8104") {
  throw new Error("E2E test helpers require the isolated Phase 7 API and database.");
}

export const e2eApiOrigin = apiOrigin;

export function readDemoAccount(): { email: string; password: string } {
  const path = process.env.E2E_DEMO_ACCOUNT_FILE || "";
  const expected = resolve(process.cwd(), `../../.runtime/phase7/${suffix}/demo-account.json`);
  if (resolve(path) !== expected) {
    throw new Error("E2E demo account must belong to this run's isolated database.");
  }
  return JSON.parse(readFileSync(expected, "utf8")) as { email: string; password: string };
}
