#!/usr/bin/env python3
"""
cli.py — SN AI Agent Validator CLI
Copyright (c) 2026 Vladimir Kapustin. License: AGPL-3.0
"""
import argparse, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))
from validator import AIAgentValidator

def main():
    parser = argparse.ArgumentParser(description="SN AI Agent Validator")
    parser.add_argument("--instance", default="https://dev362840.service-now.com")
    parser.add_argument("--user", default="admin")
    parser.add_argument("--password", default=os.environ.get("SN_PASSWORD", ""))
    parser.add_argument("--out-dir", default="reports")
    parser.add_argument("--simulate", default="ITSM Agent", help="Agent name for simulation")
    args = parser.parse_args()

    if not args.password:
        print("ERROR: Set SN_PASSWORD env var", file=sys.stderr); sys.exit(1)

    v = AIAgentValidator(instance=args.instance, user=args.user, password=args.password)
    report = v.run()
    path = v.save_report(report, out_dir=args.out_dir)
    print(f"[OK] Overall: {report.overall_score}/100 ({report.overall_status}) | Report: {path}")

if __name__ == "__main__":
    main()
