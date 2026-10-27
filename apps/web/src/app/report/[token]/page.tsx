import { notFound } from "next/navigation";
import { Waypoints, ShieldCheck } from "lucide-react";
export const dynamic = "force-dynamic";
type Report = {
  name: string;
  generated_at: string;
  period: string;
  total_runs: number;
  passed: number;
  average_latency_ms: number | null;
  results: {
    outcome: string;
    status: number | null;
    duration_ms: number;
    created_at: string;
  }[];
};
export default async function ReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[a-zA-Z0-9]{48}$/.test(token)) notFound();
  let report: Report;
  try {
    const result = await fetch(
      `${process.env.API_ORIGIN || "http://127.0.0.1:8100"}/api/v1/reports/${token}`,
      { cache: "no-store", signal: AbortSignal.timeout(10000) },
    );
    if (!result.ok) notFound();
    report = (await result.json()).data;
  } catch {
    notFound();
  }
  return (
    <main className="public-report">
      <div className="brand">
        <span className="brand-mark">
          <Waypoints size={20} />
        </span>
        FluxAPI
      </div>
      <div className="page-heading">
        <div>
          <span className="eyebrow">READ-ONLY RELIABILITY REPORT</span>
          <h1>{report.name}</h1>
          <p>
            {report.period} · Snapshot generated{" "}
            {new Date(report.generated_at)
              .toISOString()
              .slice(0, 16)
              .replace("T", " ")}{" "}
            UTC
          </p>
        </div>
        <ShieldCheck size={25} />
      </div>
      <div className="metric-grid">
        {[
          ["Total runs", report.total_runs],
          ["Passed", report.passed],
          [
            "Success rate",
            report.total_runs
              ? `${((report.passed / report.total_runs) * 100).toFixed(1)}%`
              : "—",
          ],
          [
            "Average latency",
            report.average_latency_ms === null
              ? "—"
              : `${report.average_latency_ms} ms`,
          ],
        ].map(([key, value]) => (
          <section className="panel metric-card" key={key}>
            <span>{key}</span>
            <strong>{value}</strong>
          </section>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Most recent results</h2>
          <span className="badge">Up to 50 samples</span>
        </div>
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>Result</th>
                <th>HTTP status</th>
                <th>Latency</th>
                <th>Executed (UTC)</th>
              </tr>
            </thead>
            <tbody>
              {report.results.map((r, i) => (
                <tr key={i}>
                  <td>
                    <span
                      className={`badge ${r.outcome === "passed" ? "mint" : "red"}`}
                    >
                      {r.outcome}
                    </span>
                  </td>
                  <td>{r.status || "Error"}</td>
                  <td>{r.duration_ms} ms</td>
                  <td>
                    {new Date(r.created_at)
                      .toISOString()
                      .slice(0, 19)
                      .replace("T", " ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!report.results.length && (
          <p className="pad muted">No runs were recorded for this snapshot.</p>
        )}
      </section>
      <p className="muted small">
        A fixed, scoped snapshot. API URLs, secrets, and response bodies are
        private to the workspace.
      </p>
    </main>
  );
}
