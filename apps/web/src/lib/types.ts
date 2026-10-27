export type User = {
  id: number;
  name: string;
  email: string;
  is_admin: boolean;
  email_verified_at: string | null;
  local_mail_preview?: boolean;
};
export type Workspace = {
  id: number;
  name: string;
  role: "owner" | "editor" | "viewer";
  daily_run_limit: number;
  email_alerts: boolean;
  webhook_alerts: boolean;
  webhook_available?: boolean;
};
export type Collection = {
  id: number;
  name: string;
  description: string | null;
};
export type Folder = {
  id: number;
  name: string;
  collection_id: number;
  parent_id?: number | null;
  sort_order?: number;
};
export type Assertion = {
  type: string;
  path?: string | null;
  expected?: unknown;
  actual?: unknown;
  passed?: boolean;
};
export type ApiRequest = {
  id?: number;
  name: string;
  method: string;
  url: string;
  collection_id: number | null;
  folder_id: number | null;
  headers: Record<string, string>;
  query_params: Record<string, string>;
  body: string | null;
  body_mode?: "none" | "raw" | "json" | "urlencoded" | "multipart";
  auth_type?: "none" | "bearer" | "basic" | "api_key";
  auth_config?: Record<string, string>;
  timeout_ms?: number;
  pinned?: boolean;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
  assertions: Assertion[];
};
export type Variable = {
  key: string;
  value: string | null;
  is_secret: boolean;
};
export type Environment = { id: number; name: string; variables: Variable[] };
export type Run = {
  id: number;
  api_request_id?: number | null;
  execution_id?: string | null;
  name: string;
  method: string;
  url: string;
  outcome: "passed" | "failed";
  failure_classification?: "success" | "execution_failure" | "http_failure" | "assertion_failure";
  assertion_outcome?: "passed" | "failed" | "none";
  status: number | null;
  duration_ms: number;
  size_bytes: number;
  error_code: string | null;
  source: string;
  execution_mode?: "cloud" | "local";
  timings?: {
    dns_ms?: number;
    connect_ms?: number;
    tls_ms?: number;
    first_byte_ms?: number;
  } | null;
  created_at: string;
  response_available?: boolean;
  response?: {
    headers: Record<string, string>;
    body: string | null;
    truncated: boolean;
  } | null;
  assertions?: Assertion[];
};
export type Monitor = {
  id: number;
  name: string;
  api_request_id: number;
  environment_id: number | null;
  interval_minutes: number;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_outcome: string | null;
  consecutive_failures: number;
  alert_rule: { failure_threshold: number } | null;
  last_run_id?: number | null;
  last_status?: number | null;
  last_duration_ms?: number | null;
  last_error_code?: string | null;
  checks_7d?: number;
  passed_7d?: number;
  success_rate_7d?: number | null;
  open_incidents?: number;
};
export type MonitorHistoryRun = {
  id: number;
  outcome: "passed" | "failed";
  status: number | null;
  duration_ms: number | null;
  error_code: string | null;
  execution_mode: "cloud" | "local" | null;
  created_at: string;
};
export type MonitorDetail = {
  monitor: Monitor & {
    environment_name: string | null;
    failure_threshold: number | null;
    last_success_at: string | null;
    request: null | {
      id: number;
      name: string;
      method: string;
      endpoint: string;
      assertions: {
        type: string;
        path: string | null;
        expected_status: number | null;
      }[];
    };
  };
  history: Page<MonitorHistoryRun>;
  incidents: Alert[];
};
export type Alert = {
  id: number;
  monitor_id: number;
  monitor_name?: string;
  message: string;
  created_at: string;
  resolved_at: string | null;
  acknowledged_at: string | null;
};
export type Audit = {
  id: number;
  action: string;
  user_id: number | null;
  actor_name?: string | null;
  actor_email?: string | null;
  resource_type: string | null;
  resource_id: number | null;
  created_at: string;
  workspace_id?: number;
  workspace_name?: string | null;
  resource_url?: string | null;
};
export type Share = {
  id: number;
  name: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};
export type Member = {
  id: number;
  user_id: number;
  name: string;
  email: string;
  role: string;
};
export type Summary = {
  period: string;
  period_days: number;
  total_runs: number;
  passed_runs: number;
  failed_runs: number;
  success_rate: number | null;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  monitor_availability: number | null;
  monitor_checks: number;
  monitor_overview?: {
    total: number;
    healthy: number;
    unhealthy: number;
    awaiting: number;
    paused: number;
    open_incidents: number;
    checks_in_period: number;
    passed_in_period: number;
    check_success_rate: number | null;
  };
  daily: {
    day: string;
    runs: number;
    passed: number;
    avg_ms: number;
    p95_ms?: number | null;
  }[];
  analytics_daily?: {
    day: string;
    runs: number;
    passed: number;
    avg_ms: number | null;
    p95_ms: number | null;
  }[];
  daily_assertions: { day: string; passed: number; failed: number }[];
  daily_monitor_checks?: { day: string; checks: number; passed: number }[];
  incident_opened?: { day: string; total: number }[];
  incident_recoveries?: { day: string; total: number }[];
  collections: number;
  requests: number;
  active_monitors: number;
  monitor_snapshots: {
    id: number;
    name: string;
    last_outcome: string | null;
    last_run_at: string | null;
    consecutive_failures: number;
    last_status: number | null;
    last_duration_ms: number | null;
    error_code: string | null;
    open_incidents: number;
  }[];
  open_alerts: number;
  recent_runs: Run[];
  failure_classes: { category: string; total: number }[];
  usage_today: number;
  daily_limit: number;
  cloud_runs: number;
  local_runs: number;
  assertions_passed: number;
  assertions_failed: number;
  endpoint_performance: {
    api_request_id?: number | null;
    name: string;
    method: string;
    runs: number;
    avg_ms: number;
    passed: number;
    failed?: number;
    p95_ms?: number | null;
  }[];
  status_classes: { category: string; total: number }[];
  analytics?: {
    failure_types: { category: string; total: number }[];
    sources: { category: string; total: number }[];
    execution_modes: { category: string; total: number }[];
    slowest_endpoints: {
      api_request_id: number | null;
      name: string;
      method: string;
      runs: number;
      avg_ms: number | null;
      passed: number;
      failed: number;
      p95_ms: number | null;
    }[];
    failing_endpoints: {
      api_request_id: number | null;
      name: string;
      method: string;
      runs: number;
      avg_ms: number | null;
      passed: number;
      failed: number;
      p95_ms?: number | null;
    }[];
    highest_volume_endpoints: {
      api_request_id: number | null;
      name: string;
      method: string;
      runs: number;
      avg_ms: number | null;
      passed: number;
      failed: number;
      p95_ms?: number | null;
    }[];
  };
};
export type Page<T> = {
  data: T[];
  current_page: number;
  last_page: number;
  total: number;
};

export type ExecutionPhase =
  | "idle"
  | "validating"
  | "validation_error"
  | "running"
  | "success"
  | "http_error"
  | "assertion_error"
  | "network_error"
  | "blocked"
  | "timeout"
  | "cancelled";
export type ExecutionState = {
  id: string;
  phase: ExecutionPhase;
  message?: string;
};
