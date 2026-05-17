#!/usr/bin/env python3
"""
CLI for SN Flow Designer Documenter
Copyright (C) 2026  Vladimir Kapustin
License: AGPL-3.0
"""
import argparse, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from src.documenter import FlowDocumenter


def main():
    parser = argparse.ArgumentParser(description="SN Flow Designer Documenter")
    parser.add_argument("--instance", required=True)
    parser.add_argument("--user", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--output", default="flow_docs")
    args = parser.parse_args()

    d = FlowDocumenter(args.instance, args.user, args.password)
    report = d.run(args.output)
    print(f"Documentation generated: {args.output}.md + .json")
    print(f"Actions: {report['meta']['actions_count']}, Flows: {report['meta']['flows_count']}")
    if report["warnings"]:
        print(f"Warnings: {len(report['warnings'])} actions lack descriptions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
