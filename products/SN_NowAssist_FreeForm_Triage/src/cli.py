#!/usr/bin/env python3
"""
CLI for SN NowAssist FreeForm Triage
Copyright (C) 2026  Vladimir Kapustin
License: AGPL-3.0
"""
import argparse, json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from src.triage_engine import TriageEngine


def main():
    parser = argparse.ArgumentParser(description="SN NowAssist FreeForm Triage")
    parser.add_argument("--instance", required=True)
    parser.add_argument("--user", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--input", required=True, help="JSON list of {user,text} objects")
    parser.add_argument("--output", default="triage_report.json")
    args = parser.parse_args()

    engine = TriageEngine(args.instance, args.user, args.password)
    with open(args.input, "r", encoding="utf-8") as f:
        items = json.load(f)
    results = engine.batch_triage(items)
    engine.generate_report(results, args.output)
    print(f"Triage complete. Report written to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
