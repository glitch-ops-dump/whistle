"""Pydantic models mirroring the TypeScript `IntakeAgentRecommendation` contract
(`server/ticket-spine/types.ts`). Field names are camelCase so the recommendation can be
handed back to the spine and persisted without remapping.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

PrimaryAction = Literal["route_local", "request_info", "route_protected", "reject_candidate"]

NON_MUTATION_GUARANTEE = (
    "This recommendation cannot change ticket status, queue, SLA, notifications, "
    "or audit state without a separate human-approved decision."
)

REJECTION_GUARDRAILS = [
    "Do not reject only because evidence is missing; request information first when the issue is government-addressable.",
    "Rejected tickets must enter CM-maintained rejection review.",
    "Protected/corruption signals must not be exposed to local or MLA queues before authorized screening.",
]


class TicketLocation(BaseModel):
    district: str = ""
    area: str = ""
    address: Optional[str] = None
    landmark: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class IntakeTicket(BaseModel):
    """Minimal governed projection the agent needs. No raw PII beyond what the task requires."""

    id: str
    category: str
    title: str = ""
    description: str = ""
    department_hint: Optional[str] = Field(default=None, alias="departmentHint")
    reference: Optional[str] = None
    location: TicketLocation = Field(default_factory=TicketLocation)
    evidence_count: int = Field(default=0, alias="evidenceCount")
    protected: bool = False
    updated_at: Optional[str] = Field(default=None, alias="updatedAt")

    model_config = {"populate_by_name": True}


class RecommendedOwner(BaseModel):
    ownerKey: str
    ownerLabel: str
    scopeValue: str


class EvidenceAssessment(BaseModel):
    usefulCount: int
    needsMoreEvidence: bool
    note: str


class LocationAssessment(BaseModel):
    confidence: float
    missing: list[str]


class ProtectedSignal(BaseModel):
    flagged: bool
    reasons: list[str]


class DuplicateCandidate(BaseModel):
    ticketId: str
    district: str
    category: str
    similarityReason: str


class IntakeRecommendation(BaseModel):
    primaryAction: PrimaryAction
    confidence: float
    suggestedCategory: str
    suggestedDepartment: str
    recommendedOwner: Optional[RecommendedOwner] = None
    missingFields: list[str]
    evidenceAssessment: EvidenceAssessment
    locationAssessment: LocationAssessment
    protectedSignal: ProtectedSignal
    duplicateCandidates: list[DuplicateCandidate]
    rejectionGuardrails: list[str]
    draftCitizenMessage: str
    reviewerSummary: str
    reasons: list[str]
    nonMutationGuarantee: str


class RecommendRequest(BaseModel):
    ticket: IntakeTicket
    candidates: list[IntakeTicket] = Field(default_factory=list)
    engine: Literal["deterministic", "graph"] = "deterministic"


class RecommendResponse(BaseModel):
    recommendation: IntakeRecommendation
    promptVersion: str
    modelVersion: str
    inputHash: str
    generatedAt: str
    gatewayMode: str
