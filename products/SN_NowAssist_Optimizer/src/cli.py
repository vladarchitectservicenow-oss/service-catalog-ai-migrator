#!/usr/bin/env python3
"""
cli.py — SN NowAssist Optimizer CLI
Copyright (c) 2026 Vladimir Kapustin. License: AGPL-3.0
"""
import argparse, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))
from audit_engine import NowAssistOptimizer

def main():
    parser = argparse.ArgumentParser(description="SN NowAssist Optimizer")
    parser.add_argument("--instance", default="https://dev362840.service-now.com")
    parser.add_argument("--user", default="admin")
    parser.add_argument("--password", default=os.environ.get("SN_PASSWORD", ""))
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--out-dir", default="reports")
    parser.add_argument("--check-plugin", action="store_true")
    args = parser.parse_args()

    if not args.password:
        print("ERROR: Set SN_PASSWORD env var or use --password", file=sys.stderr)
        sys.exit(1)

    engine = NowAssistOptimizer(instance=args.instance, user=args.user, password=args.password)

    if args.check_plugin:
        status = engine.check_plugin()
        import json; print(json.dumps(status, indent=2))
        return

    report = engine.run(limit=args.limit, days=args.days)
    path = engine.save_report(report, out_dir=args.out_dir)
    m = report.metrics
    print(f"[OK] Conversations: {m.total_conversations} | Deflection: {m.deflection_rate}% | KB Quality: {m.kb_quality_score}% | Routing: {m.routing_accuracy}%")
    print(f"[REPORT] {path}")

if __name__ == "__main__":
    main()
