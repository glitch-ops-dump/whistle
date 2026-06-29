from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_healthz_reports_recommend_only():
    response = client.get("/healthz")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["recommendOnly"] is True
    assert body["modelVersion"] == "deterministic-prototype-rules"


def test_recommend_endpoint_protected():
    payload = {
        "ticket": {
            "id": "api-1",
            "category": "corruption",
            "title": "Bribe demand",
            "description": "An official demanded an unofficial cash payment and warned against complaining.",
            "location": {"district": "Madurai", "area": "Taluk"},
            "evidenceCount": 1,
            "protected": True,
        }
    }
    response = client.post("/v1/intake/recommend", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["recommendation"]["primaryAction"] == "route_protected"
    assert body["recommendation"]["protectedSignal"]["flagged"] is True
    assert body["modelVersion"] == "deterministic-prototype-rules"
    assert body["promptVersion"] == "intake-verification-v2.0"
    assert len(body["inputHash"]) == 64


def test_recommend_endpoint_graph_engine_matches():
    payload = {
        "ticket": {
            "id": "api-2",
            "category": "roads",
            "title": "Pothole",
            "description": "There is a large pothole near the bus stop and it is risky during rain.",
            "location": {"district": "Chennai", "area": "Anna Nagar"},
            "evidenceCount": 0,
        },
        "engine": "graph",
    }
    response = client.post("/v1/intake/recommend", json=payload)
    assert response.status_code == 200
    assert response.json()["recommendation"]["primaryAction"] == "request_info"
