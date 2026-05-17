#!/usr/bin/env python3
"""
CLI for SN Data Fabric Governance Scanner
Copyright (C) 2026  Vladimir Kapustin
License: AGPL-3.0
"""
import argparse, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from src.governance_scanner import GovernanceScanner


def main():
    parser = argparse.ArgumentParser(description="SN Data Fabric Governance Scanner")
    parser.add_argument("--instance", required=True)
    parser.add_argument("--user", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--output", default="governance_report")
    parser.add_argument("--class-filter", default=None)
    args = parser.parse_args()

    d = GovernanceScanner(args.instance, args.user, args.password)
    report = d.run(args.output, class_filter=args.class_filter)
    print(f"Report generated: {args.output}.json + .md")
    print(f"Governance Score: {report['score']}/100")
    return 0


if __name__ == "__main__":
    sys.exit(main())
