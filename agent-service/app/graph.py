"""LangGraph intake graph.

Wires the deterministic node functions into a StateGraph that matches the topology in
docs/whistle-mvp2-architecture.md. The graph STOPS at the assembled recommendation — the
human decision happens in the spine's decision endpoint, never inside the graph, so the
graph can never resume into a mutation.

Final assembly reuses `nodes.build_recommendation` (single source of truth) so the graph
and the direct DeterministicGateway are guaranteed to produce identical output. As the
model lane lands, individual nodes gain real per-node model calls with Postgres
checkpointing; the assembled contract stays the same.
"""
from __future__ import annotations

from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from . import nodes
from .models import IntakeRecommendation, IntakeTicket


class IntakeState(TypedDict, total=False):
    ticket: IntakeTicket
    candidates: list[IntakeTicket]
    suggested_category: str
    location_missing: list[str]
    protected_reasons: list[str]
    duplicates: list
    recommendation: IntakeRecommendation


def _classify_category(state: IntakeState) -> dict:
    return {"suggested_category": nodes.suggested_category(state["ticket"])}


def _assess_location(state: IntakeState) -> dict:
    return {"location_missing": nodes.location_missing(state["ticket"])}


def _detect_protected_signal(state: IntakeState) -> dict:
    return {"protected_reasons": nodes.protected_reasons(state["ticket"])}


def _search_duplicates(state: IntakeState) -> dict:
    return {"duplicates": nodes.duplicate_candidates(state["ticket"], state.get("candidates", []))}


def _assemble_recommendation(state: IntakeState) -> dict:
    return {"recommendation": nodes.build_recommendation(state["ticket"], state.get("candidates", []))}


def build_intake_graph():
    graph = StateGraph(IntakeState)
    graph.add_node("classify_category", _classify_category)
    graph.add_node("assess_location", _assess_location)
    graph.add_node("detect_protected_signal", _detect_protected_signal)
    graph.add_node("search_duplicates", _search_duplicates)
    graph.add_node("assemble_recommendation", _assemble_recommendation)
    graph.add_edge(START, "classify_category")
    graph.add_edge("classify_category", "assess_location")
    graph.add_edge("assess_location", "detect_protected_signal")
    graph.add_edge("detect_protected_signal", "search_duplicates")
    graph.add_edge("search_duplicates", "assemble_recommendation")
    graph.add_edge("assemble_recommendation", END)
    return graph.compile()


_COMPILED = None


def run_intake_graph(ticket: IntakeTicket, candidates: list[IntakeTicket]) -> IntakeRecommendation:
    global _COMPILED
    if _COMPILED is None:
        _COMPILED = build_intake_graph()
    result = _COMPILED.invoke({"ticket": ticket, "candidates": candidates})
    return result["recommendation"]
