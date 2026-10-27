import { Auth } from "@/components/account";
import { Console } from "@/components/console";
import { notFound } from "next/navigation";
const sections = [
  "dashboard",
  "collections",
  "studio",
  "environments",
  "monitoring",
  "analytics",
  "history",
  "alerts",
  "reports",
  "settings",
  "audit",
  "admin",
];
export default async function SectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { section } = await params;
  const query = await searchParams;
  const queryValue = (key: string) =>
    typeof query[key] === "string" ? query[key] : "";
  const requestedRun = typeof query.run === "string" ? Number(query.run) : NaN;
  const runId =
    Number.isSafeInteger(requestedRun) && requestedRun > 0
      ? requestedRun
      : undefined;
  const outcomeFilter =
    query.outcome === "failed" || query.outcome === "passed"
      ? query.outcome
      : undefined;
  const requestedIncident = Number(query.incident);
  const incidentId =
    Number.isSafeInteger(requestedIncident) && requestedIncident > 0
      ? requestedIncident
      : undefined;
  const historyPage = Math.max(1, Number(query.page) || 1);
  const historyFilters = {
    search: queryValue("search"),
    method: queryValue("method"),
    status: queryValue("status"),
    outcome: outcomeFilter ?? queryValue("outcome"),
    classification: queryValue("classification"),
    assertion_outcome: queryValue("assertion_outcome"),
    source: queryValue("source"),
    mode: queryValue("mode"),
    monitor_id: queryValue("monitor_id"),
    date_from: queryValue("date_from"),
    date_to: queryValue("date_to"),
    sort: queryValue("sort") || "newest",
  };
  const incidentFilters = {
    search: queryValue("search"),
    monitor_id: queryValue("monitor_id"),
    status: queryValue("status") || "all",
    date_from: queryValue("date_from"),
    date_to: queryValue("date_to"),
    sort: queryValue("sort") || "newest",
  };
  if (["forgot-password", "reset-password", "verify-email"].includes(section))
    return <Auth mode={section} />;
  if (!sections.includes(section)) notFound();
  return (
    <Console
      section={section}
      runId={runId}
      outcomeFilter={outcomeFilter}
      historyFilters={historyFilters}
      historyPage={historyPage}
      incidentFilters={incidentFilters}
      incidentPage={historyPage}
      incidentId={incidentId}
    />
  );
}
