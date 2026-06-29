"""FastAPI surface for the recommend-only agent service.

Pure compute: this process holds no connection to the ticket database. It returns a
recommendation; the TypeScript spine persists it via recordAgentRun under RLS + audit.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import FastAPI

from . import __version__, config
from .gateway import select_gateway
from .models import RecommendRequest, RecommendResponse
from .nodes import input_hash
from .prompts import get_active_prompt

app = FastAPI(title="Whistle Agent Service", version=__version__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.get("/healthz")
def healthz() -> dict:
    prompt = get_active_prompt("intake_verification")
    return {
        "status": "ok",
        "service": config.SERVICE_NAME,
        "version": __version__,
        "gatewayMode": config.gateway_mode(),
        "promptVersion": prompt.version,
        "modelVersion": config.MODEL_VERSION,
        "recommendOnly": True,
    }


@app.post("/v1/intake/recommend", response_model=RecommendResponse)
def recommend(request: RecommendRequest) -> RecommendResponse:
    if request.engine == "graph":
        # Lazy import so the deterministic path does not require langgraph to be installed.
        from .graph import run_intake_graph

        recommendation = run_intake_graph(request.ticket, request.candidates)
    else:
        gateway = select_gateway(protected=request.ticket.protected)
        recommendation = gateway.recommend(request.ticket, request.candidates)

    return RecommendResponse(
        recommendation=recommendation,
        promptVersion=config.PROMPT_VERSION,
        modelVersion=config.MODEL_VERSION,
        inputHash=input_hash(request.ticket),
        generatedAt=_now_iso(),
        gatewayMode=config.gateway_mode(),
    )
