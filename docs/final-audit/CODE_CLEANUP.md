# Code, dependency and release-artifact audit

Audit date: 27 October 2026. No business logic or dependency was removed during this quality gate. The only product-source fix was a responsive CSS breakpoint correction in `apps/web/src/styles/finish.css`; the remaining additions are these audit reports and retained synthetic screenshots.

## Dependency review

- `npm.cmd audit --prefix apps/web --audit-level=low`: **0 vulnerabilities**.
- Local Composer audit for `apps/api`: **no security advisories**.
- ESLint, strict TypeScript and a Next.js production build passed.
- Existing runtime packages serve identifiable paths in the application: Next/React for the web app, TanStack Query for API state, CodeMirror and its JSON/language packages for the request/response editor, Lucide icons and the locally packaged IBM Plex fonts. Playwright, ESLint, TypeScript and Prettier are development tooling.
- No unused-dependency analyzer was installed or run. No dependency was removed based on superficial source search. A future dependency cleanup should use a verified import graph, check dynamic imports and build/test the result.

## Source and artifact observations

- The source tree is present as untracked Git content: `git status --short` lists repository roots as `??` (including `apps/`, `docs/`, `scripts/` and infrastructure). There is no usable tracked baseline or reliable `git diff` for distinguishing pre-existing user changes from earlier work. The audit's own additions are known, but the complete pre-audit repository history is not inferable from this checkout.
- `.gitignore` and `.dockerignore` exclude local `.env` files, `.runtime`, `.tools`, `.backups`, `node_modules`, `.next*`, `test-results`, private outbox files and generated provider caches. `docs/previews` is excluded from Docker context. These exclusions should be preserved.
- `.runtime/phase7/` includes isolated E2E credentials, test mail/storage and logs; `.tools/` includes local runtime binaries; `.backups/` may contain user data. These are sensitive local artifacts. Do not include them in deployment archives, public repositories or portfolio ZIPs.
- `apps/web/.next*`, `node_modules` and `test-results` are generated build/test output. E2E screenshots are useful review evidence but are not runtime assets. The ten selected final-gate screenshots were copied to `docs/final-audit/evidence/` as the intentional deliverable.
- Existing `docs/previews/` contains historical UI reference captures. They were not removed or treated as dead files. The `APIForge` internal identifiers and environment names remain by design; Phase 1 explicitly says not to silently rename internal system identifiers.
- No broad dead-component or duplicated-helper removal was justified by this read-only review. Existing CSS has multiple scoped responsive rules by module; no unused-code deletion was attempted.

## Exact files added or modified by this quality-gate task

The repository has no tracked diff baseline; this list is the task-owned change set recorded during the audit.

| Change | File |
| --- | --- |
| Responsive correction: use the existing compact Audit layout at tablet widths 761–820px, matching the collapsed sidebar's available content width | `apps/web/src/styles/finish.css` |
| Requirements traceability matrix | `docs/final-audit/REQUIREMENTS_MATRIX.md` |
| Functional QA and test results | `docs/final-audit/FUNCTIONAL_QA.md` |
| Security review | `docs/final-audit/SECURITY_REVIEW.md` |
| Performance report | `docs/final-audit/PERFORMANCE_REPORT.md` |
| Cleanup and dependency review | `docs/final-audit/CODE_CLEANUP.md` |
| Operational readiness | `docs/final-audit/PRODUCTION_READINESS.md` |
| Final quality-gate decision | `docs/final-audit/FINAL_GATE.md` |
| Screenshot evidence (10 PNGs) | `docs/final-audit/evidence/audit-trail-*` and `admin-console-*` |

The temporary `phase9-benchmark.spec.ts` and `phase9-audit-768.spec.ts` were removed after successful runs. No package manifest, lockfile, migration, runtime dependency, environment credential or APP_KEY was changed. Generated `.next-phase7-e2e-*`, `.runtime/phase7/*`, database records and E2E user accounts were left intact per the no-cleanup requirement.

## Safe cleanup plan

1. Keep the checked-in ignore rules and exclude `.env*`, `.runtime`, `.tools`, `.backups`, `node_modules`, `.next*`, database data directories and generated E2E accounts from any ZIP or release bundle.
2. Keep selected audit evidence only if the reports are being distributed; otherwise preserve it as review evidence and do not delete automatically.
3. Have the database owner explicitly decide whether old retained E2E databases should be archived or removed. This audit did not delete any database or credential.
4. Establish the correct Git baseline before creating a release diff; stage only verified source, docs and intended assets. Inspect ignored/local files before packaging.
5. Reassess package usage only with a safe analyzer and complete regression/build run; no cleanup is recommended solely from naming or age.
