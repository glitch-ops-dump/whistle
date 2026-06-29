from app.models import NON_MUTATION_GUARANTEE, IntakeRecommendation, IntakeTicket
from app.nodes import build_recommendation


def ticket(**kw) -> IntakeTicket:
    return IntakeTicket.model_validate(kw)


def test_sparse_ticket_requests_info():
    rec = build_recommendation(
        ticket(
            id="t1",
            category="roads",
            title="Pothole near bus stop needs repair",
            description="There is a large pothole near the bus stop and it is risky during rain.",
            location={"district": "Chennai", "area": "Anna Nagar"},
            evidenceCount=0,
        ),
        [],
    )
    assert rec.primaryAction == "request_info"
    assert "address or landmark" in rec.missingFields
    assert "supporting photo or reference" in rec.missingFields
    assert rec.nonMutationGuarantee == NON_MUTATION_GUARANTEE


def test_corruption_routes_protected():
    rec = build_recommendation(
        ticket(
            id="t2",
            category="corruption",
            title="Bribe demand at local office",
            description="An official demanded an unofficial cash payment to process a certificate.",
            departmentHint="Revenue",
            location={"district": "Madurai", "area": "Taluk Office", "landmark": "Main counter"},
            evidenceCount=1,
            protected=True,
        ),
        [],
    )
    assert rec.primaryAction == "route_protected"
    assert rec.protectedSignal.flagged is True


def test_complete_ticket_routes_local_with_owner():
    rec = build_recommendation(
        ticket(
            id="t3",
            category="roads",
            title="Damaged footpath outside school",
            description="The footpath outside the government school has been broken for three weeks and is dangerous during peak traffic.",
            location={"district": "Coimbatore", "area": "Gandhipuram", "landmark": "School gate", "address": "12 Mettupalayam Road"},
            evidenceCount=2,
        ),
        [],
    )
    assert rec.primaryAction == "route_local"
    assert rec.recommendedOwner is not None
    assert rec.recommendedOwner.ownerKey.startswith("local:")


def test_too_short_description_rejects():
    rec = build_recommendation(
        ticket(
            id="t4",
            category="water",
            title="No water",
            description="No water here.",
            location={"district": "Trichy", "area": "Srirangam", "landmark": "Temple street", "address": "5 East Chitra Street"},
            evidenceCount=1,
        ),
        [],
    )
    assert rec.primaryAction == "reject_candidate"


def test_hidden_corruption_signal_in_civic_category_is_flagged():
    # Safety-critical: a corruption signal in a non-corruption category must still be caught.
    rec = build_recommendation(
        ticket(
            id="t5",
            category="roads",
            title="Contractor work issue",
            description="The road contractor demanded a bribe before fixing our street and threatened residents who asked for receipts.",
            location={"district": "Salem", "area": "Hasthampatti", "landmark": "Water tank road"},
            evidenceCount=0,
        ),
        [],
    )
    assert rec.primaryAction == "route_protected"
    assert rec.protectedSignal.flagged is True


def test_recommendation_round_trips_camelcase():
    rec = build_recommendation(
        ticket(id="t6", category="roads", title="Streetlight broken", description="Streetlight on the main road has been off for a week now.", location={"district": "Chennai", "area": "T Nagar"}, evidenceCount=0),
        [],
    )
    dumped = rec.model_dump()
    assert "primaryAction" in dumped and "nonMutationGuarantee" in dumped and "duplicateCandidates" in dumped
    # Re-validates cleanly against the schema (structured-output contract).
    assert IntakeRecommendation.model_validate(dumped) == rec
