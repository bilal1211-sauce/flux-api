# APIForge — a connected API reliability workspace

Developers often keep requests, environment values, test outcomes and endpoint health in different tools. APIForge brings these into one workspace with persistent data and a clear trust boundary around network execution.

The interface uses a restrained graphite design with mint actions and readable status accents. A saved request moves from Collections to Request Studio, produces a real response and declarative assertions, and becomes a scheduled monitor. History, analytics and scoped reports all derive from those stored execution records.

The implementation combines Laravel 13, MySQL 8.4 and a Next.js/React TypeScript frontend. A same-origin gateway protects browser sessions, workspace-scoped queries enforce tenant boundaries, and a separate executor restricts approved HTTPS destinations and pins validated DNS answers at connection time. Secrets are encrypted and redacted before run persistence.

The most consequential integration bug found by browser testing was a rate-limit key collision: normal API traffic consumed the stricter execution allowance. Separate named limiters fixed it, and a regression test now performs 25 ordinary reads before verifying execution still succeeds. Feature tests also caught a date-cast mismatch in daily usage accounting that appeared during repeated runs; quota storage now uses an explicit date string.

The tested local deliverable includes every named product area in a documented subset. It intentionally distinguishes in-app alerts from external delivery, sampled availability from continuous uptime, and supported OpenAPI import from full schema validation. The Docker/Redis topology is provided for deployment review, with public hosting and host-level egress enforcement remaining deployment work.

See `VALIDATION.md` for measured checks and `previews/` for browser captures. No uptime history, run counts or latency samples are invented for presentation.
