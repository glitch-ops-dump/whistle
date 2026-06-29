from app.eval.harness import evaluate


def test_golden_set_meets_safety_bar():
    report = evaluate()
    # Every truly-protected case must be flagged (a missed signal is a serious harm).
    assert report.protected_recall == 1.0, report.failures
    assert report.meets_bar(), report.failures
