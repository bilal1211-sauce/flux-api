# Local API execution

Cloud execution goes through Laravel and the isolated executor. Local execution sends the target request directly from the browser to an optional companion on the developer's computer. The two modes are selected explicitly in Request Studio; a failed local run never falls back to Cloud.

## Start and pair

Keep the usual APIForge services running, then open a second terminal in the project directory:

```powershell
npm.cmd run companion -- --origin "http://127.0.0.1:3000" --allow-localhost
```

The companion prints a random token for this process. In Request Studio select **Local**, paste the token and select **Connect**. Keep the terminal private. Stop the companion with Ctrl+C; its token and active executions are discarded. It does not start automatically with `npm run dev`.

The `--allow-localhost` flag explicitly permits HTTP requests to `localhost`, `127.0.0.1` or `::1`. Without it, only HTTPS destinations are accepted. For a remotely hosted UI, use its exact HTTPS origin and add `--allow-cloud-origin`; that grants this one origin permission to pair with the local service and does not change destination checks. Do not pair a shared or untrusted UI origin.

## Safeguards and limits

- The listener binds only to `127.0.0.1:8102`. Requests require a constant-time checked bearer token, the exact configured `Origin` and a loopback `Host`; CORS preflight is explicit and responses are `no-store`.
- Public destinations require HTTPS. The companion resolves every A/AAAA record, rejects private/reserved/mixed answers, pins a validated address and verifies TLS. Redirects and proxy environment variables are not used. Local HTTP is limited to explicit loopback hostnames and addresses.
- Supported methods are GET, POST, PUT, PATCH, DELETE, HEAD and OPTIONS. Request and response bodies are capped at 1 MiB, timeouts at 60 seconds, active requests at four, and request rate at 120 per minute.
- Only a file explicitly selected in the browser can be included in a multipart request; the file is not saved by the companion. There is no local file browsing or arbitrary code execution.
- Saved environment secrets remain encrypted on the server and are masked from the browser. For Local mode, referenced secret values are requested in a temporary password prompt, sent only to the paired companion with the target request, and cleared after execution. Do not use Local mode on a shared browser profile or a UI you do not trust.
- Local results are reported back to the authenticated API with request query/body/auth data removed and response secrets redacted. The target response is received by the browser, so its sanitization is best-effort client reporting; users with access to browser developer tools can inspect their own live response. Local assertions are also evaluated in the browser. Cloud run assertions remain server-evaluated.
- Local runs create history and usage records but cannot impersonate scheduled Cloud monitor checks. Stopping a Cloud wait cancels the browser request; the remote target might already have processed it.

The companion's deterministic tests run with `node --test scripts/companion.test.mjs`. The browser integration test uses a temporary loopback HTTP server to verify pairing, authorization, secret prompting and redacted history.
