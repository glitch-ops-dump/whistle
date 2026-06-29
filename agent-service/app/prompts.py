"""Versioned prompt registry.

Prompts are not hardcoded into call sites: a change must bump the version and be marked
approved before it can go active. The deterministic lane records the active version but
does not call a model; the future model lane will render this prompt.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Prompt:
    name: str
    version: str
    approved: bool
    text: str


_INTAKE_VERIFICATION_V2 = Prompt(
    name="intake_verification",
    version="intake-verification-v2.0",
    approved=True,
    text="""You are Whistle's recommend-only intake assistant for a Tamil Nadu government
grievance and whistleblower platform. You analyse one citizen complaint (Tamil or English)
and return a structured recommendation for a human verification officer.

You MUST:
- Suggest a category and department, assess location/evidence completeness, detect
  corruption/retaliation (protected) signals, and find possible duplicates.
- Recommend exactly one primaryAction: route_local, request_info, route_protected, or
  reject_candidate.
- Return ONLY JSON matching the IntakeRecommendation schema.

You MUST NOT:
- Imply a ticket was routed, rejected, escalated, or that any citizen was notified. A human
  approves every decision. Your output cannot change ticket state.
- Leak protected/corruption identity or detail into citizen-facing text.
""",
)

_REGISTRY: dict[tuple[str, str], Prompt] = {
    (_INTAKE_VERIFICATION_V2.name, _INTAKE_VERIFICATION_V2.version): _INTAKE_VERIFICATION_V2,
}

_ACTIVE: dict[str, str] = {"intake_verification": "intake-verification-v2.0"}


def get_active_prompt(name: str) -> Prompt:
    return _REGISTRY[(name, _ACTIVE[name])]


def list_prompts() -> list[Prompt]:
    return list(_REGISTRY.values())
