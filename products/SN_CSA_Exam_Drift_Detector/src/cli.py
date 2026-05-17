#!/usr/bin/env python3
"""
CLI for SN CSA Exam Drift Detector
Copyright (C) 2026  Vladimir Kapustin
License: AGPL-3.0
"""
import argparse, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from src.drift_detector import CSADriftDetector


def main():
    parser = argparse.ArgumentParser(description="SN CSA Exam Drift Detector")
    parser.add_argument("--instance", required=True)
    parser.add_argument("--user", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--release", default="zurich", choices=["zurich", "australia"])
    parser.add_argument("--category", default=None, help="Filter by exam category")
    parser.add_argument("--output", default="drift_report")
    args = parser.parse_args()

    d = CSADriftDetector(args.instance, args.user, args.password, args.release)
    report = d.run(output_prefix=args.output, category=args.category)
    print(f"Drift report generated: {args.output}.json + .md")
    print(f"Alignment score: {report['score']}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
