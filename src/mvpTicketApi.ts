type SpineRequestOptions = {
  idempotencyKey?: string;
  phone?: string;
  phoneVerificationToken?: string;
};

declare global {
  interface Window {
    __WHISTLE_API_DISABLED__?: boolean;
  }
}

type CitizenTicketPayload = {
  category: string;
  language: "en" | "ta";
  title: string;
  description: string;
  phone: string;
  phoneVerificationToken?: string;
  reference?: string;
  departmentHint?: string;
  location: {
    district: string;
    area: string;
    address?: string;
    landmark?: string;
  };
  evidence: Array<{
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }>;
};

type CitizenUpdatePayload = {
  details: string;
  address?: string;
  evidence: Array<{
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }>;
};

type CitizenDisputePayload = {
  reason: string;
  evidence: Array<{
    label: "after";
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }>;
};

export type CitizenEvidenceUploadPayload = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  file?: File;
};

export type TicketSpineEvent = {
  id: string;
  ticketId: string;
  type: string;
  actor: string;
  message: string;
  createdAt: string;
  visibility: "citizen" | "government" | "protected";
};

export type TicketSpineNotification = {
  id: string;
  ticketId: string;
  channel: "in_app" | "sms" | "whatsapp";
  status: "queued" | "sent" | "failed" | "suppressed";
  topic: string;
  safeMessage: string;
  sensitive: boolean;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
};

export type MockOtpChallenge = {
  challengeId: string;
  phoneMasked: string;
  expiresAt: string;
  resendAfter: string;
  mockOtp?: string;
  delivery: "sms_mock";
  deliveryProvider: string;
  providerMessageId: string;
};

export type MockOtpVerification = {
  verificationToken: string;
  phoneMasked: string;
  verifiedAt: string;
  expiresAt: string;
};

export type CitizenCategoryAvailability = {
  id: string;
  labelEn: string;
  labelTa: string;
  sensitivity: "public_aggregate" | "identity_masked" | "protected";
  enabled: boolean;
  intakeStatus: "open" | "protected_pilot" | "pilot_only" | "blocked" | "disabled";
  message: string;
};

export type PublicAssetUse = {
  approved: boolean;
  src: string | null;
  label: string;
  fallbackLabel: string;
};

export type PublicAssetPolicy = {
  logo: PublicAssetUse;
  emblem: PublicAssetUse;
  portrait: PublicAssetUse;
  disclaimer: {
    approved: boolean;
    text: string;
  };
};

export type TicketSpineTicket = {
  id: string;
  category: string;
  title: string;
  description: string;
  reference?: string;
  departmentHint?: string;
  status: string;
  protected: boolean;
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
  primaryQueue: {
    kind: string;
    ownerLabel: string;
  };
  secondaryQueues: Array<{
    kind: string;
    ownerLabel: string;
  }>;
  sla: {
    stage: string;
    state: string;
    dueAt: string | null;
    paused: boolean;
  };
  citizenTimeline: TicketSpineEvent[];
  createdAt: string;
  updatedAt: string;
};

export type TicketSpineEvidenceUploadSession = {
  evidence: TicketSpineTicket["evidence"][number];
  uploadMethod: "PUT";
  uploadUrl: string;
  expiresAt: string;
  requiredHeaders: Record<string, string>;
};

type TicketSpineCreateAcceptedResponse = {
  ticket: TicketSpineTicket;
  rejected?: TicketSpineRejectedResponse | null;
};

type TicketSpineCreateResponse = {
  ticket: TicketSpineTicket | null;
  rejected?: TicketSpineRejectedResponse | null;
};

type TicketSpineRejectedResponse = {
  error?: string;
  message?: string;
};

export type TicketSpineCreateResult =
  | { ok: true; data: TicketSpineCreateAcceptedResponse }
  | { ok: false; kind: "unavailable" }
  | { ok: false; kind: "rejected"; status: number; error: string; message: string };

export type TicketSpineUpdateResult =
  | { ok: true; data: { ticket: TicketSpineTicket } }
  | { ok: false; kind: "unavailable" }
  | { ok: false; kind: "rejected"; status: number; error: string; message: string };

export type TicketSpineDisputeResult =
  | { ok: true; data: { ticket: TicketSpineTicket } }
  | { ok: false; kind: "unavailable" }
  | { ok: false; kind: "rejected"; status: number; error: string; message: string };

export type TicketSpineFetchResult =
  | { ok: true; data: { ticket: TicketSpineTicket } }
  | { ok: false; kind: "unavailable" }
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: "rejected"; status: number; error: string; message: string };

export type TicketSpineNotificationsResult =
  | { ok: true; data: { notifications: TicketSpineNotification[] } }
  | { ok: false; kind: "unavailable" }
  | { ok: false; kind: "rejected"; status: number; error: string; message: string };

export type TicketSpineCitizenTicketsResult =
  | { ok: true; data: { tickets: TicketSpineTicket[] } }
  | { ok: false; kind: "unavailable" }
  | { ok: false; kind: "rejected"; status: number; error: string; message: string };

export type TicketSpineEvidenceUploadResult =
  | { ok: true; data: { ticket: TicketSpineTicket; uploadedCount: number; evidenceIds: string[] } }
  | { ok: false; kind: "unavailable"; uploadedCount: number; message: string }
  | { ok: false; kind: "rejected"; status: number; error: string; message: string; uploadedCount: number };

export type MockOtpStartResult =
  | { ok: true; data: { challenge: MockOtpChallenge } }
  | { ok: false; kind: "unavailable" }
  | { ok: false; kind: "rejected"; status: number; error: string; message: string };

export type MockOtpVerifyResult =
  | { ok: true; data: { verification: MockOtpVerification } }
  | { ok: false; kind: "unavailable" }
  | { ok: false; kind: "rejected"; status: number; error: string; message: string };

export type CitizenConfigResult =
  | { ok: true; data: { assetPolicy: PublicAssetPolicy; categories: CitizenCategoryAvailability[]; controls?: { phoneOtpRequired: boolean } } }
  | { ok: false; kind: "unavailable" }
  | { ok: false; kind: "rejected"; status: number; error: string; message: string };

const apiBase = import.meta.env.VITE_WHISTLE_API_BASE ?? "http://localhost:3001";

function apiDisabled() {
  return typeof window !== "undefined" && window.__WHISTLE_API_DISABLED__ === true;
}

function citizenAccessHeaders(options: SpineRequestOptions = {}): Record<string, string> {
  if (!options.phone || !options.phoneVerificationToken) return {};
  return {
    "x-whistle-citizen-phone": options.phone,
    "x-whistle-citizen-token": options.phoneVerificationToken,
  };
}

async function rejectedResponse(response: Response, fallbackError: string, fallbackMessage: string) {
  const body = (await response.json().catch(() => ({}))) as TicketSpineRejectedResponse;
  return {
    status: response.status,
    error: body.error ?? fallbackError,
    message: body.message ?? fallbackMessage,
  };
}

export async function fetchCitizenConfig(): Promise<CitizenConfigResult> {
  if (apiDisabled()) return { ok: false, kind: "unavailable" };
  try {
    const response = await fetch(`${apiBase}/api/citizen/config`);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as TicketSpineRejectedResponse;
      return {
        ok: false,
        kind: "rejected",
        status: response.status,
        error: body.error ?? "citizen_config_rejected",
        message: body.message ?? "Citizen launch controls could not be loaded.",
      };
    }
    return { ok: true, data: (await response.json()) as { assetPolicy: PublicAssetPolicy; categories: CitizenCategoryAvailability[]; controls?: { phoneOtpRequired: boolean } } };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function startMockOtpChallenge(phone: string, language: "en" | "ta"): Promise<MockOtpStartResult> {
  if (apiDisabled()) return { ok: false, kind: "unavailable" };
  try {
    const response = await fetch(`${apiBase}/api/citizen/otp/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, language }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as TicketSpineRejectedResponse;
      return {
        ok: false,
        kind: "rejected",
        status: response.status,
        error: body.error ?? "otp_start_rejected",
        message: body.message ?? "Could not start phone verification.",
      };
    }
    return { ok: true, data: (await response.json()) as { challenge: MockOtpChallenge } };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function verifyMockOtpChallenge(challengeId: string, otp: string): Promise<MockOtpVerifyResult> {
  if (apiDisabled()) return { ok: false, kind: "unavailable" };
  try {
    const response = await fetch(`${apiBase}/api/citizen/otp/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId, otp }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as TicketSpineRejectedResponse;
      return {
        ok: false,
        kind: "rejected",
        status: response.status,
        error: body.error ?? "otp_verify_rejected",
        message: body.message ?? "The OTP could not be verified.",
      };
    }
    return { ok: true, data: (await response.json()) as { verification: MockOtpVerification } };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function createTicketInSpine(payload: CitizenTicketPayload, options: SpineRequestOptions = {}): Promise<TicketSpineCreateResult> {
  if (apiDisabled()) return { ok: false, kind: "unavailable" };
  try {
    const response = await fetch(`${apiBase}/api/tickets`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
        ...citizenAccessHeaders(options),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as TicketSpineRejectedResponse;
      return {
        ok: false,
        kind: "rejected",
        status: response.status,
        error: body.error ?? "ticket_rejected",
        message: body.message ?? "This complaint cannot be submitted with the current government configuration.",
      };
    }
    const body = (await response.json()) as TicketSpineCreateResponse;
    if (!body.ticket) {
      return {
        ok: false,
        kind: "rejected",
        status: response.status,
        error: body.rejected?.error ?? "ticket_rejected",
        message: body.rejected?.message ?? "This complaint cannot be submitted with the current government configuration.",
      };
    }
    return {
      ok: true,
      data: {
        ticket: body.ticket,
        rejected: body.rejected,
      },
    };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

async function uploadSingleCitizenEvidenceToSpine(ticketId: string, payload: CitizenEvidenceUploadPayload, options: SpineRequestOptions = {}) {
  const sessionResponse = await fetch(`${apiBase}/api/tickets/${encodeURIComponent(ticketId)}/evidence/upload-session`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...citizenAccessHeaders(options),
    },
    body: JSON.stringify(payload),
  });
  if (!sessionResponse.ok) {
    return {
      ok: false as const,
      rejected: await rejectedResponse(sessionResponse, "evidence_upload_session_rejected", "Evidence upload session could not be created."),
    };
  }
  const { session } = (await sessionResponse.json()) as { session: TicketSpineEvidenceUploadSession };

  if (payload.file) {
    const checksum = await sha256Hex(payload.file);
    const binaryResponse = await fetch(
      `${apiBase}/api/tickets/${encodeURIComponent(ticketId)}/evidence/${encodeURIComponent(session.evidence.id)}/upload-binary`,
      {
        method: "PUT",
        credentials: "include",
        headers: {
          "content-type": payload.mimeType,
          "x-whistle-content-sha256": checksum,
          ...citizenAccessHeaders(options),
        },
        body: payload.file,
      },
    );
    if (!binaryResponse.ok) {
      return {
        ok: false as const,
        rejected: await rejectedResponse(binaryResponse, "evidence_upload_binary_rejected", "Evidence file bytes could not be stored."),
      };
    }
    return {
      ok: true as const,
      data: (await binaryResponse.json()) as { ticket: TicketSpineTicket; evidence: TicketSpineTicket["evidence"][number] },
    };
  }

  const completeResponse = await fetch(
    `${apiBase}/api/tickets/${encodeURIComponent(ticketId)}/evidence/${encodeURIComponent(session.evidence.id)}/complete-upload`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...citizenAccessHeaders(options),
      },
      body: JSON.stringify({
        mimeType: payload.mimeType,
        sizeBytes: payload.sizeBytes,
        checksum: `mvp-sha256:${session.evidence.id}:${payload.sizeBytes}`,
      }),
    },
  );
  if (!completeResponse.ok) {
    return {
      ok: false as const,
      rejected: await rejectedResponse(completeResponse, "evidence_upload_complete_rejected", "Evidence upload could not be completed."),
    };
  }
  return {
    ok: true as const,
    data: (await completeResponse.json()) as { ticket: TicketSpineTicket; evidence: TicketSpineTicket["evidence"][number] },
  };
}

async function sha256Hex(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function uploadCitizenEvidenceToSpine(
  ticketId: string,
  evidence: CitizenEvidenceUploadPayload[],
  options: SpineRequestOptions = {},
): Promise<TicketSpineEvidenceUploadResult> {
  if (apiDisabled()) {
    return { ok: false, kind: "unavailable", uploadedCount: 0, message: "Ticket spine API is unavailable in this static export." };
  }
  if (!evidence.length) {
    const ticket = await fetchTicketFromSpine(ticketId, options);
    if (ticket.ok) return { ok: true, data: { ticket: ticket.data.ticket, uploadedCount: 0, evidenceIds: [] } };
    return { ok: false, kind: "unavailable", uploadedCount: 0, message: "Ticket spine unavailable after complaint submission." };
  }

  try {
    const results = await Promise.all(evidence.map((item) => uploadSingleCitizenEvidenceToSpine(ticketId, item, options)));
    const uploaded = results.filter((result): result is Extract<(typeof results)[number], { ok: true }> => result.ok);
    const rejected = results.find((result): result is Extract<(typeof results)[number], { ok: false }> => !result.ok);
    if (rejected) {
      return {
        ok: false,
        kind: "rejected",
        uploadedCount: uploaded.length,
        status: rejected.rejected.status,
        error: rejected.rejected.error,
        message: rejected.rejected.message,
      };
    }
    const lastTicket = uploaded[uploaded.length - 1]?.data.ticket;
    if (!lastTicket) return { ok: false, kind: "unavailable", uploadedCount: 0, message: "Evidence upload result was empty." };
    return {
      ok: true,
      data: {
        ticket: lastTicket,
        uploadedCount: uploaded.length,
        evidenceIds: uploaded.map((result) => result.data.evidence.id),
      },
    };
  } catch {
    return { ok: false, kind: "unavailable", uploadedCount: 0, message: "Evidence upload service unavailable after complaint submission." };
  }
}

export async function submitCitizenUpdateInSpine(ticketId: string, payload: CitizenUpdatePayload, options: SpineRequestOptions = {}): Promise<TicketSpineUpdateResult> {
  if (apiDisabled()) return { ok: false, kind: "unavailable" };
  try {
    const response = await fetch(`${apiBase}/api/tickets/${encodeURIComponent(ticketId)}/citizen-update`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
        ...citizenAccessHeaders(options),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as TicketSpineRejectedResponse;
      return {
        ok: false,
        kind: "rejected",
        status: response.status,
        error: body.error ?? "citizen_update_rejected",
        message: body.message ?? "This update could not be submitted to the ticket spine.",
      };
    }
    const body = (await response.json()) as { ticket: TicketSpineTicket };
    return { ok: true, data: body };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function submitCitizenDisputeInSpine(ticketId: string, payload: CitizenDisputePayload, options: SpineRequestOptions = {}): Promise<TicketSpineDisputeResult> {
  if (apiDisabled()) return { ok: false, kind: "unavailable" };
  try {
    const response = await fetch(`${apiBase}/api/tickets/${encodeURIComponent(ticketId)}/reopen-dispute`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
        ...citizenAccessHeaders(options),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as TicketSpineRejectedResponse;
      return {
        ok: false,
        kind: "rejected",
        status: response.status,
        error: body.error ?? "citizen_dispute_rejected",
        message: body.message ?? "This closure dispute could not be submitted to the ticket spine.",
      };
    }
    const body = (await response.json()) as { ticket: TicketSpineTicket };
    return { ok: true, data: body };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function fetchTicketFromSpine(ticketId: string, options: SpineRequestOptions = {}): Promise<TicketSpineFetchResult> {
  if (apiDisabled()) return { ok: false, kind: "unavailable" };
  try {
    const response = await fetch(`${apiBase}/api/tickets/${encodeURIComponent(ticketId)}`, {
      credentials: "include",
      headers: citizenAccessHeaders(options),
    });
    if (response.status === 404) return { ok: false, kind: "not_found" };
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as TicketSpineRejectedResponse;
      return {
        ok: false,
        kind: "rejected",
        status: response.status,
        error: body.error ?? "ticket_fetch_rejected",
        message: body.message ?? "This ticket cannot be refreshed from the ticket spine.",
      };
    }
    return { ok: true, data: (await response.json()) as { ticket: TicketSpineTicket } };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function fetchTicketNotificationsFromSpine(ticketId: string, options: SpineRequestOptions = {}): Promise<TicketSpineNotificationsResult> {
  if (apiDisabled()) return { ok: false, kind: "unavailable" };
  try {
    const response = await fetch(`${apiBase}/api/tickets/${encodeURIComponent(ticketId)}/notifications`, {
      credentials: "include",
      headers: citizenAccessHeaders(options),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as TicketSpineRejectedResponse;
      return {
        ok: false,
        kind: "rejected",
        status: response.status,
        error: body.error ?? "ticket_notifications_rejected",
        message: body.message ?? "This ticket's notification history cannot be refreshed.",
      };
    }
    return { ok: true, data: (await response.json()) as { notifications: TicketSpineNotification[] } };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function fetchCitizenTicketsFromSpine(phone: string, options: SpineRequestOptions = {}): Promise<TicketSpineCitizenTicketsResult> {
  if (apiDisabled()) return { ok: false, kind: "unavailable" };
  try {
    const params = new URLSearchParams({ phone });
    const response = await fetch(`${apiBase}/api/citizen/tickets?${params.toString()}`, {
      credentials: "include",
      headers: citizenAccessHeaders(options),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as TicketSpineRejectedResponse;
      return {
        ok: false,
        kind: "rejected",
        status: response.status,
        error: body.error ?? "citizen_tickets_rejected",
        message: body.message ?? "Citizen tickets could not be loaded from the ticket spine.",
      };
    }
    return { ok: true, data: (await response.json()) as { tickets: TicketSpineTicket[] } };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}
