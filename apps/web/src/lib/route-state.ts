export type HistoryRouteFilters = {
  search: string;
  method: string;
  status: string;
  outcome: string;
  classification: string;
  assertion_outcome: string;
  source: string;
  mode: string;
  monitor_id: string;
  date_from: string;
  date_to: string;
  sort: string;
};

export type IncidentRouteFilters = {
  search: string;
  monitor_id: string;
  status: string;
  date_from: string;
  date_to: string;
  sort: string;
};
