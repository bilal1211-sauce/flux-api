# Performance report

Audit date: 27 October 2026. Measurements are local, bounded development baselines, not production service-level commitments.

## Test environment and method

- Windows PowerShell workspace; Intel Core i5-2500 CPU at 3.30GHz and 16GiB RAM.
- Project PHP 8.3.35, Node 24.21.0, MySQL 8.4.11 and Next.js 16.4.2.
- API, executor and web app ran on loopback through the guarded E2E harness. Docker and the production proxy were not available.
- The performance fixture used a new isolated database with 25 saved requests and 20 synthetic **local recorded execution** rows for one endpoint. No Cloud execution or outbound HTTP target was used. The database/user and storage were retained after the run.
- Endpoint timing used two warm-up reads followed by ten measured sequential reads for each endpoint. Each duration includes the local Node Playwright API client, loopback HTTP and application work. Percentiles use nearest-rank selection; 10 samples make P95 a coarse local indicator.
- Browser timing used one authenticated navigation sequence at 1440×900; n=1, so it is only a baseline.

## Measured API and browser timings

| Endpoint / operation | Samples | Median | P95 | Notes |
| --- | ---: | ---: | ---: | --- |
| `GET /workspaces/{id}/requests?per_page=25` | 10 | **319.54ms** | **432.39ms** | Workspace had 25 saved requests. |
| `GET /workspaces/{id}/runs?per_page=25` | 10 | **253.70ms** | **405.80ms** | Workspace had 20 synthetic local run records. |
| `GET /workspaces/{id}/summary?days=30` | 10 | **278.88ms** | **447.08ms** | One endpoint group with the 20 samples needed for endpoint P95. |
| Record 20 synthetic local runs | 1 batch | **10.66s** | N/A | About 533ms per sequential write on this local harness; includes HTTP and persistence. |
| Initial sign-in page to visible form | 1 | **1318.49ms** | N/A | Authenticated E2E account; cold page navigation. |
| Submit sign-in to visible workspace overview | 1 | **3213.69ms** | N/A | Includes auth request and application load. |
| Client navigation to API Analytics | 1 | **228.07ms** | N/A | Starts at click and ends at visible `API Analytics` heading. |

The values are exact outputs of the temporary benchmark spec. They should not be compared to the historical Oct 2026 summary numbers in `docs/VALIDATION.md` as a code-only regression: the fixture, sample size, endpoint, and method differ.

## Frontend build size

The successful isolated production build in `.next-phase7-e2e-fd029e7b0605` contained 15 production JavaScript chunk files totaling **1,382,130 raw bytes** and 3 CSS files totaling **191,242 raw bytes**. These are minified file sizes before transfer compression; gzip/Brotli sizes were not measured. Build routes included static `/`, `/_not-found`, `/icon.svg` and dynamic `/[section]`, `/api/gateway/[...path]`, `/report/[token]`.

No Lighthouse/Core Web Vitals run, browser memory profile, large-response stress test, chart render profile or multi-user load test was executed. No benchmark was run against production or a public third-party service.

## Source-level query and payload observations

- Run history uses server-side pagination capped at 100 rows; request listing also caps at 100 and preloads assertions for that page. Run-list pages do not load full response bodies; those are fetched through the authorized detail endpoint.
- By source inspection, a non-empty requests page issues approximately four resource data queries: total count, page rows, eager-loaded assertions and grouped collection counts. Workspace authentication/membership queries are additional. This is a source-derived estimate; a DB query listener was not enabled, so it is **not** a measured total query count.
- Analytics aggregates counts, daily groups and distributions in SQL. Endpoint P95 for up to eight slowest endpoint groups performs a count plus an ordered sample lookup per group once a group reaches 20 samples. That can add up to 16 scalar queries to a summary response. This is a bounded code-level hotspot to profile before very large workspaces; no production-scale latency impact has been established.
- Monitoring and run-history APIs paginate/bound history and redacted detail. The browser tests verify bounded page behavior and recent history, but this audit did not benchmark a large monitor/run table.
- The collection explorer requests pages on demand in Studio; Collections assembles paged resource data for the searchable tree. Very large workspaces should be tested for browser memory and request volume before capacity claims.
- Charts use the existing project implementation with no new chart dependency. Rendering cost and touch-tooltip frame time were not instrumented.

## Findings and next measurements

The isolated read medians were roughly 254–320ms and P95 values 406–447ms on this older desktop host. This suggests useful development responsiveness but cannot establish production capacity. The measured write batch was slower than reads; it includes 20 separate POSTs and transaction/persistence work, so it is not a database-only cost.

Before production sizing, repeat the benchmark with a representative but bounded dataset at increasing sizes (for example 1k and 10k retained runs), enable per-request SQL query counts and slow-query logging in staging, record query plans for Analytics/History/Monitoring, and capture browser network waterfalls and memory snapshots. Keep the dataset isolated and do not run load tests against a live provider or production database.
