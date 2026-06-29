from app.graph import run_intake_graph
from app.models import IntakeTicket
from app.nodes import build_recommendation

CASES = [
    {"id": "g1", "category": "roads", "title": "Pothole", "description": "Large pothole near the bus stop, risky in rain.", "location": {"district": "Chennai", "area": "Anna Nagar"}, "evidenceCount": 0},
    {"id": "g2", "category": "corruption", "title": "Bribe demand", "description": "Official demanded an unofficial cash payment and threatened retaliation.", "location": {"district": "Madurai", "area": "Taluk"}, "evidenceCount": 1, "protected": True},
]


def test_graph_matches_deterministic_gateway():
    for case in CASES:
        ticket = IntakeTicket.model_validate(case)
        via_graph = run_intake_graph(ticket, [])
        direct = build_recommendation(ticket, [])
        assert via_graph.model_dump() == direct.model_dump()


def test_graph_flags_protected():
    ticket = IntakeTicket.model_validate(CASES[1])
    rec = run_intake_graph(ticket, [])
    assert rec.primaryAction == "route_protected"
    assert rec.protectedSignal.flagged is True
