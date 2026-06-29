import { createIntakeAgentRun } from "./agentic.js";
import { internalId } from "./lifecycle.js";
import type { AgentRecommendationRun, IntakeAgentRecommendation, TicketRecord } from "./types.js";

// Seam between the spine and the recommend-only Python agent service. When
// WHISTLE_AGENT_SERVICE_URL is configured the spine calls the service; on any error or
// timeout it falls back to the in-process deterministic baseline, so an agent-service
// outage can never block verification. The env is read at call time so it is runtime
// configurable and testable. Identity + persistence stay with the spine (recordAgentRun).

const PURPOSE = "intake_verification" as const;
const REQUEST_TIMEOUT_MS = 2500;

function agentServiceUrl(): string {
  return process.env.WHISTLE_AGENT_SERVICE_URL?.trim() ?? "";
}

export function agentServiceConfigured(): boolean {
  return agentServiceUrl().length > 0;
}

function ticketProjection(ticket: TicketRecord) {
  return {
    id: ticket.id,
    category: ticket.category,
    title: ticket.title,
    description: ticket.description,
    departmentHint: ticket.departmentHint,
    reference: ticket.reference,
    location: {
      district: ticket.location.district,
      area: ticket.location.area,
      address: ticket.location.address,
      landmark: ticket.location.landmark,
      latitude: ticket.location.latitude,
      longitude: ticket.location.longitude,
    },
    evidenceCount: ticket.evidence.length,
    protected: ticket.protected,
    updatedAt: ticket.updatedAt,
  };
}

type RecommendResponse = {
  recommendation: IntakeAgentRecommendation;
  promptVersion: string;
  modelVersion: string;
  inputHash: string;
};

async function requestRecommendation(ticket: TicketRecord, allTickets: TicketRecord[]): Promise<RecommendResponse> {
  const url = `${agentServiceUrl().replace(/\/$/, "")}/v1/intake/recommend`;
  const body = {
    ticket: ticketProjection(ticket),
    candidates: allTickets.filter((candidate) => candidate.id !== ticket.id).map(ticketProjection),
  };
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`agent service returned ${response.status}`);
  const payload = (await response.json()) as RecommendResponse;
  if (!payload?.recommendation?.primaryAction) throw new Error("agent service returned a malformed recommendation");
  return payload;
}

export async function createIntakeAgentRunViaGateway(
  ticket: TicketRecord,
  allTickets: TicketRecord[],
  actor: string,
): Promise<AgentRecommendationRun> {
  if (!agentServiceConfigured()) {
    return createIntakeAgentRun(ticket, allTickets, actor);
  }
  try {
    const payload = await requestRecommendation(ticket, allTickets);
    return {
      id: internalId("agent"),
      ticketId: ticket.id,
      actor,
      purpose: PURPOSE,
      promptVersion: payload.promptVersion,
      modelVersion: payload.modelVersion,
      inputHash: payload.inputHash,
      recommendation: payload.recommendation,
      createdAt: new Date().toISOString(),
    };
  } catch {
    // Degraded mode: the deterministic baseline keeps verification unblocked.
    return createIntakeAgentRun(ticket, allTickets, actor);
  }
}
