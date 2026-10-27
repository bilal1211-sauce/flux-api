export default async function globalSetup() {
  const origin = process.env.E2E_API_ORIGIN;
  const database = process.env.E2E_DATABASE_NAME;
  const username = process.env.E2E_DATABASE_USER;
  if (!origin || !database || !username) {
    throw new Error("Missing verified isolated E2E database identity.");
  }

  const response = await fetch(`${origin}/api/v1/health`);
  if (!response.ok) {
    throw new Error(`Isolated API health check failed with HTTP ${response.status}.`);
  }
  const health = (await response.json()).data?.e2e_guard;
  if (
    health?.environment !== "e2e" ||
    health?.database !== database ||
    health?.database_user !== username ||
    health?.database_host !== "127.0.0.1" ||
    health?.database_port !== 3307
  ) {
    throw new Error("Playwright stopped because the API did not confirm the isolated Phase 7 E2E database.");
  }
}
