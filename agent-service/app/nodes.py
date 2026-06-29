"""Deterministic intake pipeline ported from `server/ticket-spine/agentic.ts`.

These pure node functions are the behaviour-compatible baseline AND the fallback the model
lane degrades to. They are composed both directly (DeterministicGateway) and as LangGraph
nodes (graph.py), so the two runners produce identical output.
"""
from __future__ import annotations

import hashlib
import json
import re

from .models import (
    DuplicateCandidate,
    EvidenceAssessment,
    IntakeRecommendation,
    IntakeTicket,
    LocationAssessment,
    NON_MUTATION_GUARANTEE,
    PrimaryAction,
    ProtectedSignal,
    RecommendedOwner,
    REJECTION_GUARDRAILS,
)

CATEGORY_SIGNALS: list[tuple[str, list[str]]] = [
    ("corruption", ["bribe", "cash", "commission", "unofficial", "corrupt", "kickback", "demand"]),
    ("roads", ["road", "pothole", "street", "footpath", "drain cover", "traffic"]),
    ("water", ["water", "leak", "drinking", "tanker", "sewage", "pipeline"]),
    ("power", ["power", "electric", "street light", "tangedco", "transformer"]),
    ("sanitation", ["garbage", "waste", "drain", "sewer", "sanitation"]),
    ("safety", ["unsafe", "crime", "police", "danger", "public safety"]),
    ("health", ["hospital", "clinic", "medicine", "health", "doctor"]),
    ("education", ["school", "teacher", "student", "classroom", "education"]),
    ("revenue", ["certificate", "land record", "patta", "taluk", "revenue"]),
    ("ration", ["ration", "pds", "fair price", "rice", "card"]),
]

# Mirrors the spine's category -> ministry mapping (server/ticket-spine/dashboard.ts).
# Keep in sync with ministryForTicket; the seam may override with the spine's canonical map.
DEPARTMENT_BY_CATEGORY: dict[str, str] = {
    "corruption": "Protected Screening / CM Cell",
    "roads": "Highways / Local Body",
    "water": "Municipal Administration and Water Supply",
    "power": "Energy Department",
    "sanitation": "Municipal Administration and Water Supply",
    "safety": "Home / Police",
    "health": "Health Department",
    "education": "School Education Department",
    "revenue": "Revenue Department",
    "ration": "Food and Civil Supplies",
    "other": "Verification-assigned owner",
}

PROTECTED_TEXT_SIGNALS = ["bribe", "unofficial payment", "cash demand", "retaliation", "threat"]


def normalize(value: str) -> str:
    return value.strip().lower()


def combined_text(ticket: IntakeTicket) -> str:
    parts = [
        ticket.title,
        ticket.description,
        ticket.department_hint or "",
        ticket.reference or "",
        ticket.location.area,
        ticket.location.landmark or "",
    ]
    return " ".join(part for part in parts if part).lower()


def suggested_category(ticket: IntakeTicket) -> str:
    text = combined_text(ticket)
    scored = sorted(
        (
            (category, sum(1 for word in words if word in text))
            for category, words in CATEGORY_SIGNALS
        ),
        key=lambda item: item[1],
        reverse=True,
    )
    top_category, top_score = scored[0]
    return top_category if top_score else ticket.category


def department_for(category: str) -> str:
    return DEPARTMENT_BY_CATEGORY.get(category, DEPARTMENT_BY_CATEGORY["other"])


def location_missing(ticket: IntakeTicket) -> list[str]:
    missing: list[str] = []
    if not ticket.location.district:
        missing.append("district")
    if not ticket.location.area:
        missing.append("area")
    has_point = ticket.location.latitude is not None and ticket.location.longitude is not None
    if not ticket.location.address and not ticket.location.landmark and not has_point:
        missing.append("address or landmark")
    return missing


def protected_reasons(ticket: IntakeTicket) -> list[str]:
    text = combined_text(ticket)
    reasons: list[str] = []
    if ticket.protected:
        reasons.append("Ticket is already in protected intake.")
    if ticket.category == "corruption":
        reasons.append("Category is corruption.")
    if any(word in text for word in PROTECTED_TEXT_SIGNALS):
        reasons.append("Complaint text contains corruption or retaliation-risk signals.")
    return reasons


def _title_words(value: str) -> set[str]:
    return {word for word in re.split(r"[^a-z0-9]+", normalize(value)) if len(word) > 3}


def duplicate_candidates(ticket: IntakeTicket, candidates: list[IntakeTicket]) -> list[DuplicateCandidate]:
    title_words = _title_words(ticket.title)
    scored = []
    for candidate in candidates:
        if candidate.id == ticket.id:
            continue
        same_district = normalize(candidate.location.district) == normalize(ticket.location.district)
        same_area = normalize(candidate.location.area) == normalize(ticket.location.area)
        same_category = candidate.category == ticket.category
        overlap = sum(
            1 for word in re.split(r"[^a-z0-9]+", normalize(candidate.title)) if word in title_words
        )
        score = int(same_district) + int(same_area) + int(same_category) + overlap
        scored.append((candidate, score, same_area, same_category))

    scored = [item for item in scored if item[1] >= 2]
    scored.sort(key=lambda item: item[1], reverse=True)
    result: list[DuplicateCandidate] = []
    for candidate, _score, same_area, same_category in scored[:3]:
        reason = ", ".join(
            part
            for part in [
                "same category" if same_category else None,
                "same area" if same_area else "same district",
                "similar complaint wording",
            ]
            if part
        )
        result.append(
            DuplicateCandidate(
                ticketId=candidate.id,
                district=candidate.location.district,
                category=candidate.category,
                similarityReason=reason,
            )
        )
    return result


def local_owner(ticket: IntakeTicket) -> RecommendedOwner:
    scope_value = ticket.location.area or ticket.location.district or "local-scope"
    slug = re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", normalize(scope_value))) or "local-owner"
    return RecommendedOwner(
        ownerKey=f"local:{slug}",
        ownerLabel=f"{scope_value} Local/MLA Owner",
        scopeValue=scope_value,
    )


def input_hash(ticket: IntakeTicket) -> str:
    payload = {
        "id": ticket.id,
        "category": ticket.category,
        "title": ticket.title,
        "description": ticket.description,
        "location": ticket.location.model_dump(),
        "evidenceCount": ticket.evidence_count,
        "updatedAt": ticket.updated_at,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def decide_primary_action(protected_signal_reasons: list[str], missing_fields: list[str], ticket: IntakeTicket) -> PrimaryAction:
    if protected_signal_reasons:
        return "route_protected"
    if missing_fields:
        return "request_info"
    if len(ticket.description.strip()) < 24:
        return "reject_candidate"
    return "route_local"


def build_recommendation(ticket: IntakeTicket, candidates: list[IntakeTicket]) -> IntakeRecommendation:
    missing = location_missing(ticket)
    protected_signal_reasons = protected_reasons(ticket)
    suggested = suggested_category(ticket)
    duplicates = duplicate_candidates(ticket, candidates)
    needs_evidence = ticket.evidence_count == 0 and not ticket.protected
    missing_fields = list(missing) + (["supporting photo or reference"] if needs_evidence else [])
    suggested_department = department_for(suggested)

    primary_action = decide_primary_action(protected_signal_reasons, missing_fields, ticket)
    route_owner = local_owner(ticket) if primary_action == "route_local" else None

    confidence_base = (
        0.58
        + (0.12 if len(ticket.description) > 80 else 0.0)
        + (0.08 if ticket.location.district else 0.0)
        + (0.08 if ticket.evidence_count else 0.0)
    )
    confidence = min(0.94, max(0.42, round(confidence_base, 2)))

    reasons = [
        f"Suggested category: {suggested}.",
        f"Suggested department: {suggested_department}.",
        f"Missing fields: {', '.join(missing_fields)}."
        if missing_fields
        else "Location and evidence are sufficient for human routing review.",
        f"Protected signals: {' '.join(protected_signal_reasons)}"
        if protected_signal_reasons
        else "No protected corruption signal beyond configured category policy.",
        f"{len(duplicates)} possible duplicate or cluster candidate(s) found."
        if duplicates
        else "No strong duplicate candidate found in the current queue.",
    ]

    location_confidence = 0.54 if missing else (0.86 if (ticket.location.landmark or ticket.location.address) else 0.72)

    draft = (
        f"Please add {', '.join(missing_fields)} so the verification team can route your complaint safely."
        if missing_fields
        else "Your complaint has enough information for verification review. The government team will route it to the accountable owner after human approval."
    )

    return IntakeRecommendation(
        primaryAction=primary_action,
        confidence=confidence,
        suggestedCategory=suggested,
        suggestedDepartment=suggested_department,
        recommendedOwner=route_owner,
        missingFields=missing_fields,
        evidenceAssessment=EvidenceAssessment(
            usefulCount=ticket.evidence_count,
            needsMoreEvidence=needs_evidence,
            note=(
                "No evidence is attached; request a photo/reference before local routing unless urgency overrides."
                if needs_evidence
                else "Evidence metadata is present for human inspection."
            ),
        ),
        locationAssessment=LocationAssessment(confidence=location_confidence, missing=missing),
        protectedSignal=ProtectedSignal(flagged=len(protected_signal_reasons) > 0, reasons=protected_signal_reasons),
        duplicateCandidates=duplicates,
        rejectionGuardrails=list(REJECTION_GUARDRAILS),
        draftCitizenMessage=draft,
        reviewerSummary=(
            f"{primary_action.replace('_', ' ')} recommended with {round(confidence * 100)}% confidence "
            f"for {ticket.location.district or 'unknown district'}."
        ),
        reasons=reasons,
        nonMutationGuarantee=NON_MUTATION_GUARANTEE,
    )
