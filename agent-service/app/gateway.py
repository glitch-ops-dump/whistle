"""LLM gateway abstraction (mirrors the spine's NotificationDeliveryProvider seam).

Models are swappable behind this interface without touching graph/pipeline logic.
- DeterministicGateway: the ported rule baseline; always available; the outage fallback.
- (future) ManagedGateway / SelfHostGateway: real models, with structured-output validation
  and fallback to deterministic. Protected/corruption inputs must use the self-host lane.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from .models import IntakeRecommendation, IntakeTicket
from .nodes import build_recommendation


class LLMGateway(ABC):
    mode: str = "abstract"

    @abstractmethod
    def health_check(self) -> None:
        """Raise if the lane is not usable."""

    @abstractmethod
    def recommend(self, ticket: IntakeTicket, candidates: list[IntakeTicket]) -> IntakeRecommendation:
        """Return a recommend-only intake recommendation. Must never mutate state."""


class DeterministicGateway(LLMGateway):
    mode = "deterministic-prototype-rules"

    def health_check(self) -> None:
        return None

    def recommend(self, ticket: IntakeTicket, candidates: list[IntakeTicket]) -> IntakeRecommendation:
        return build_recommendation(ticket, candidates)


def select_gateway(protected: bool = False) -> LLMGateway:
    """Lane router.

    Today: always deterministic. When a model is wired, `protected=True` must select the
    in-India self-hosted lane and non-protected may use a managed in-region lane, each
    falling back to DeterministicGateway on outage or invalid structured output.
    """
    return DeterministicGateway()
