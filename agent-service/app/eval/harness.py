"""Offline evaluation harness.

Runs the active gateway over the golden set and scores it. `protected_recall` is the
safety-critical gate: a missed whistleblower/corruption signal is a serious harm, so the
default bar is 1.0. A model lane may not be promoted to production below the bar.

Run:  python -m app.eval.harness   (exits non-zero if the bar is not met)
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path

from ..gateway import select_gateway
from ..models import IntakeTicket

GOLDEN_PATH = Path(__file__).parent / "golden_set.json"


@dataclass
class EvalReport:
    total: int
    action_correct: int
    protected_total: int
    protected_flagged: int
    action_accuracy: float
    protected_recall: float
    failures: list[str]

    def meets_bar(self, min_action_accuracy: float = 0.8, min_protected_recall: float = 1.0) -> bool:
        return self.action_accuracy >= min_action_accuracy and self.protected_recall >= min_protected_recall


def load_cases(path: Path = GOLDEN_PATH) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["cases"]


def evaluate(cases: list[dict] | None = None) -> EvalReport:
    cases = cases if cases is not None else load_cases()
    gateway = select_gateway()
    total = len(cases)
    action_correct = 0
    protected_total = 0
    protected_flagged = 0
    failures: list[str] = []

    for case in cases:
        ticket = IntakeTicket.model_validate(case["ticket"])
        rec = gateway.recommend(ticket, [])
        if rec.primaryAction == case["expectedAction"]:
            action_correct += 1
        else:
            failures.append(f"{case['id']}: action {rec.primaryAction} != {case['expectedAction']}")
        if case["expectedProtected"]:
            protected_total += 1
            if rec.protectedSignal.flagged:
                protected_flagged += 1
            else:
                failures.append(f"{case['id']}: protected signal MISSED (safety-critical)")

    return EvalReport(
        total=total,
        action_correct=action_correct,
        protected_total=protected_total,
        protected_flagged=protected_flagged,
        action_accuracy=action_correct / total if total else 0.0,
        protected_recall=(protected_flagged / protected_total) if protected_total else 1.0,
        failures=failures,
    )


def main() -> int:
    report = evaluate()
    print(f"cases={report.total} action_accuracy={report.action_accuracy:.2f} protected_recall={report.protected_recall:.2f}")
    for failure in report.failures:
        print(f"  FAIL {failure}")
    ok = report.meets_bar()
    print("RESULT:", "PASS" if ok else "BELOW BAR")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
