# Whistle Agent Service (recommend-only)

Python + FastAPI + LangGraph companion to the TypeScript ticket spine. It runs the
**recommend-only** intake graph and returns an `IntakeAgentRecommendation`. It is **pure
compute**: it holds no connection or write credential to the ticket database, so the
non-mutation guarantee is structural, not just tested. The spine persists the recommendation
via `recordAgentRun` under RLS + audit.

See `docs/whistle-mvp2-architecture.md` and `docs/whistle-mvp2-spec.md` for the full design.

## Layout

```
app/
  models.py        Pydantic models mirroring server/ticket-spine/types.ts (camelCase contract)
  nodes.py         Deterministic intake pipeline ported from server/ticket-spine/agentic.ts
  gateway.py       LLMGateway abstraction + DeterministicGateway + lane router (select_gateway)
  graph.py         LangGraph StateGraph wiring the nodes (stops at the reviewer packet)
  prompts.py       Versioned prompt registry (intake-verification-v2.0)
  eval/            golden_set.json + harness.py (protected_recall is the safety gate)
  main.py          FastAPI: GET /healthz, POST /v1/intake/recommend
tests/             pytest: recommendation parity, graph parity, API, eval bar
```

## Run

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8088
# health
curl localhost:8088/healthz
# recommend (deterministic lane)
curl -s localhost:8088/v1/intake/recommend -H 'content-type: application/json' -d '{
  "ticket": {"id":"t1","category":"corruption","title":"Bribe demand",
             "description":"An official demanded an unofficial cash payment.",
             "location":{"district":"Madurai","area":"Taluk"},"evidenceCount":1,"protected":true}
}'
```

`?engine=graph` (or `"engine":"graph"` in the body) runs the same logic through LangGraph.

## Test & evaluate

```bash
python -m pytest            # unit + API + parity + eval-bar tests
python -m app.eval.harness  # prints action_accuracy + protected_recall; exits non-zero below the bar
```

## How the spine calls it

The spine's `server/ticket-spine/agentGateway.ts` calls `POST /v1/intake/recommend` when
`WHISTLE_AGENT_SERVICE_URL` is set, and **falls back to the in-process deterministic baseline**
on any error or timeout — so a service outage can never block verification. The endpoint
returns `{ recommendation, promptVersion, modelVersion, inputHash, generatedAt }`; the spine
wraps it into an agent run and owns identity + persistence.

## Lanes (today vs. next)

`select_gateway()` returns the deterministic gateway today. When a model is wired:
`protected=True` inputs must use the **in-India self-hosted lane** (Sarvam-M); non-protected
bulk may use a **managed in-region lane** (Sarvam API / Vertex Gemini, `asia-south1`). Each
lane validates structured output and falls back to deterministic. Do not send protected /
corruption text to a managed lane. Prompts come from the registry; a change must bump the
version and be approved; the model may not be promoted to production below the eval bar
(`protected_recall = 1.0`).
