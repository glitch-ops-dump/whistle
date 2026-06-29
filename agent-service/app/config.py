"""Service configuration and lane selection.

The model version + prompt version mirror the TypeScript baseline
(`server/ticket-spine/agentic.ts`) so the deterministic lane is behaviour-compatible
with the spine's in-process fallback.
"""
from __future__ import annotations

import os

SERVICE_NAME = "whistle-agent-service"
PROMPT_VERSION = "intake-verification-v2.0"
MODEL_VERSION = "deterministic-prototype-rules"


def gateway_mode() -> str:
    """Which LLM lane to use.

    Today everything is deterministic. When a real model is wired, protected/corruption
    inputs must route to the in-India self-hosted lane (Sarvam-M) and non-sensitive bulk
    intake may use a managed in-region lane (Sarvam API / Vertex Gemini). See
    docs/whistle-mvp2-architecture.md.
    """
    return os.environ.get("WHISTLE_AGENT_GATEWAY", "deterministic")
