import { officialAuthHeadersAsync } from "./officialAuthClient";

export type GovRole = "cm_cell" | "minister" | "department_officer" | "mla" | "councillor" | "verification" | "admin";

export type QueueKind = "citizen" | "verification" | "protected_review" | "rejection_review" | "local" | "mla" | "ministry" | "cm_cell";

export type QueueAssignmentDto = {
  kind: QueueKind;
  ownerKey: string;
  ownerLabel: string;
  scope: {
    jurisdiction: "state" | "district" | "constituency" | "ward" | "ministry" | "protected";
    value: string;
  };
};

export type DashboardTicketDto = {
  id: string;
  title: string;
  category: string;
  status: string;
  protected: boolean;
  district: string;
  area: string;
  ministry: string;
  primaryQueue: QueueAssignmentDto;
  secondaryQueues: QueueAssignmentDto[];
  sla: {
    stage: string;
    state: string;
    dueAt: string | null;
    paused: boolean;
  };
  citizenIdentityVisible: boolean;
  evidenceCount: number;
  createdAt: string;
  updatedAt: string;
};

export type TicketEventDto = {
  id: string;
  ticketId: string;
  type: string;
  actor: string;
  message: string;
  createdAt: string;
  visibility: "citizen" | "government" | "protected";
};

export type TicketDetailDto = {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  protected: boolean;
  citizenPhoneMasked: string;
  departmentHint?: string;
  location: {
    district: string;
    area: string;
    address?: string;
    landmark?: string;
  };
  evidence: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    storageState: string;
  }>;
  primaryQueue: QueueAssignmentDto;
  secondaryQueues: QueueAssignmentDto[];
  sla: {
    stage: string;
    state: string;
    dueAt: string | null;
    paused: boolean;
  };
  citizenTimeline: TicketEventDto[];
  governmentEvents: TicketEventDto[];
  createdAt: string;
  updatedAt: string;
};

export type DashboardMetricRowDto = {
  key: string;
  label: string;
  openTickets: number;
  slaBreached: number;
  dueIn48h: number;
  protectedCount: number;
};

export type RoleDashboardDto = {
  role: GovRole;
  scope: Record<string, string | number | undefined>;
  readModel?: {
    source: "ticket_graph" | "postgres_sql_projection";
    aggregateStrategy: "in_memory_ticket_graph" | "bounded_sql_aggregates";
    ticketRowsHydrated: number;
    scopedTicketTotal: number;
  };
  kpis: {
    openTickets: number;
    slaBreached: number;
    dueToday: number;
    dueIn48h: number;
    escalatedToCmCell: number;
    protectedCount: number;
    rejectionReview: number;
    averageAgeHours: number;
  };
  byDistrict: DashboardMetricRowDto[];
  byMinistry: DashboardMetricRowDto[];
  ticketWindow?: {
    limit: number;
    offset: number;
    cursor: string | null;
    total: number;
    returned: number;
    hasMore: boolean;
    nextOffset: number | null;
    nextCursor: string | null;
  };
  tickets: DashboardTicketDto[];
};

export type DashboardBriefRiskLevel = "low" | "watch" | "elevated" | "critical";

export type DashboardBriefDto = {
  role: "cm_cell" | "minister";
  scope: DashboardRequest;
  generatedAt: string;
  headline: string;
  summary: string;
  riskLevel: DashboardBriefRiskLevel;
  kpis: {
    openTickets: number;
    slaBreached: number;
    dueToday: number;
    dueIn48h: number;
    escalatedToCmCell: number;
    protectedCount: number;
    averageAgeHours: number;
  };
  focusAreas: Array<{
    label: string;
    value: string;
    detail: string;
    tone: DashboardBriefRiskLevel;
  }>;
  recommendedActions: Array<{
    label: string;
    owner: string;
    reason: string;
    due: string;
    readOnly: true;
  }>;
  watchlist: Array<{
    ticketId: string;
    title: string;
    district: string;
    ministry: string;
    queue: QueueKind;
    slaState: string;
    dueAt: string | null;
    reason: string;
    protected: boolean;
  }>;
  nonMutationGuarantee: string;
};

export type DashboardBriefRunDto = {
  id: string;
  actor: string;
  purpose: "dashboard_sla_brief";
  role: "cm_cell" | "minister";
  scope: DashboardRequest;
  promptVersion: string;
  modelVersion: string;
  inputHash: string;
  brief: DashboardBriefDto;
  createdAt: string;
};

export type DashboardRequest = {
  role: GovRole;
  ministry?: string;
  district?: string;
  constituency?: string;
  ward?: string;
  queue?: QueueKind | "all";
  primaryQueue?: QueueKind | "all";
  q?: string;
  ticketLimit?: number;
  ticketOffset?: number;
};

export type DashboardAuth = {
  role: GovRole;
  actor: string;
};

export type FieldActionRequest =
  | {
      action: "schedule_visit";
      actor?: string;
      fieldOfficer: string;
      visitAt: string;
      note: string;
    }
  | {
      action: "add_field_report";
      actor?: string;
      fieldOfficer: string;
      note: string;
      evidence?: Array<{
        label?: "before" | "after" | "field_report" | "closure";
        fileName: string;
        mimeType: string;
        sizeBytes: number;
      }>;
    }
  | {
      action: "transfer";
      actor?: string;
      reason: string;
      ownerKey: string;
      ownerLabel: string;
      scopeKind: "district" | "constituency" | "ward" | "ministry";
      scopeValue: string;
      queueKind: "local" | "mla" | "ministry";
    }
  | {
      action: "resolve";
      actor?: string;
      resolutionNote: string;
      checklist: {
        fieldVisitCompleted: boolean;
        evidenceAttached: boolean;
        citizenImpactChecked: boolean;
        safetyRiskClosed: boolean;
      };
      evidence?: Array<{
        label?: "before" | "after" | "field_report" | "closure";
        fileName: string;
        mimeType: string;
        sizeBytes: number;
      }>;
    };

export type RejectionReviewActionRequest =
  | {
      action: "uphold_rejection";
      actor?: string;
      reason: string;
      closureNote: string;
    }
  | {
      action: "request_info";
      actor?: string;
      reason: string;
      missingFields: string[];
      citizenMessage: string;
    }
  | {
      action: "overturn_and_route";
      actor?: string;
      reason: string;
      ownerKey: string;
      ownerLabel: string;
      scopeValue: string;
    };

const apiBase = import.meta.env.VITE_WHISTLE_API_BASE ?? "http://localhost:3001";

export async function fetchRoleDashboard(
  request: DashboardRequest,
  signal?: AbortSignal,
  auth?: DashboardAuth,
): Promise<RoleDashboardDto> {
  const params = new URLSearchParams();
  Object.entries(request).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });

  const response = await fetch(`${apiBase}/api/dashboard?${params.toString()}`, {
    credentials: "include",
    signal,
    headers: auth ? await officialAuthHeadersAsync(auth) : undefined,
  });
  if (!response.ok) throw new Error(`Dashboard API failed with ${response.status}`);
  const body = (await response.json()) as { dashboard: RoleDashboardDto };
  return body.dashboard;
}

export async function fetchTicketDetail(ticketId: string, auth: DashboardAuth, signal?: AbortSignal): Promise<TicketDetailDto> {
  const response = await fetch(`${apiBase}/api/tickets/${encodeURIComponent(ticketId)}`, {
    credentials: "include",
    signal,
    headers: await officialAuthHeadersAsync(auth, {
      accessReason: auth.role === "cm_cell" || auth.role === "verification" ? "Operational ticket detail review" : undefined,
    }),
  });
  if (!response.ok) throw new Error(`Ticket detail API failed with ${response.status}`);
  const body = (await response.json()) as { ticket: TicketDetailDto };
  return body.ticket;
}

export async function generateDashboardBrief(
  request: DashboardRequest,
  signal?: AbortSignal,
  auth?: DashboardAuth,
): Promise<DashboardBriefRunDto> {
  const response = await fetch(`${apiBase}/api/dashboard/briefs`, {
    method: "POST",
    credentials: "include",
    signal,
    headers: auth ? await officialAuthHeadersAsync(auth, { json: true }) : { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`Dashboard brief API failed with ${response.status}`);
  const body = (await response.json()) as { run: DashboardBriefRunDto };
  return body.run;
}

export async function submitFieldAction(
  ticketId: string,
  action: FieldActionRequest,
  auth: DashboardAuth,
): Promise<DashboardTicketDto> {
  const response = await fetch(`${apiBase}/api/tickets/${encodeURIComponent(ticketId)}/field-actions`, {
    method: "POST",
    credentials: "include",
    headers: await officialAuthHeadersAsync(auth, { json: true }),
    body: JSON.stringify(action),
  });
  if (!response.ok) {
    let message = `Field action failed with ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      // Keep the transport-level message when the API does not return JSON.
    }
    throw new Error(message);
  }
  const body = (await response.json()) as { ticket: DashboardTicketDto };
  return body.ticket;
}

export async function submitRejectionReviewAction(
  ticketId: string,
  action: RejectionReviewActionRequest,
  auth: DashboardAuth,
): Promise<DashboardTicketDto> {
  const response = await fetch(`${apiBase}/api/rejection-review/${encodeURIComponent(ticketId)}/decision`, {
    method: "POST",
    credentials: "include",
    headers: await officialAuthHeadersAsync(auth, { json: true }),
    body: JSON.stringify(action),
  });
  if (!response.ok) {
    let message = `Rejection review action failed with ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      // Keep the transport-level message when the API does not return JSON.
    }
    throw new Error(message);
  }
  const body = (await response.json()) as { ticket: DashboardTicketDto };
  return body.ticket;
}

export function hoursUntil(iso: string | null) {
  if (!iso) return 0;
  return Math.round((new Date(iso).getTime() - Date.now()) / (60 * 60 * 1000));
}
