#!/usr/bin/env python3
"""
CLI for SN Upgrade Preview Validator
Copyright (C) 2026  Vladimir Kapustin
License: AGPL-3.0
"""
import argparse, sys, os
from src.validator import UpgradePreviewValidator


def main():
    parser = argparse.ArgumentParser(description="ServiceNow Upgrade Preview Validator")
    parser.add_argument("--instance", required=True, help="Instance URL")
    parser.add_argument("--user", required=True, help="Username")
    parser.add_argument("--password", required=True, help="Password")
    parser.add_argument("--baseline", default=None, help="Path to baseline JSON snapshot")
    parser.add_argument("--output", default="upgrade_delta", help="Output prefix (.json + .md)")
    parser.add_argument("--table", default=None, help="Filter by table name")
    args = parser.parse_args()

    v = UpgradePreviewValidator(args.instance, args.user, args.password)
    report = v.run(baseline_path=args.baseline, output_prefix=args.output, table_filter=args.table)
    total = sum(report["summary"].values())
    print(f"Processed {total} skipped records. Report written to {args.output}.json and {args.output}.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
