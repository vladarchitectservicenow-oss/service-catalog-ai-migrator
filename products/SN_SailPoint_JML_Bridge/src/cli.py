#!/usr/bin/env python3
"""
CLI for SN SailPoint JML Bridge
Copyright (C) 2026  Vladimir Kapustin
License: AGPL-3.0
"""
import argparse, sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from src.bridge import SailPointBridge


def main():
    parser = argparse.ArgumentParser(description="SN SailPoint JML Bridge")
    parser.add_argument("--sn-url", required=True)
    parser.add_argument("--sn-user", required=True)
    parser.add_argument("--sn-pass", required=True)
    parser.add_argument("--sp-url", required=True)
    parser.add_argument("--sp-token", required=True)
    parser.add_argument("--event", required=True, choices=["join", "move", "leave"])
    parser.add_argument("--user", required=True, help="sys_user sys_id")
    parser.add_argument("--audit", default="sailpoint_audit.json")
    args = parser.parse_args()

    b = SailPointBridge(args.sn_url, args.sn_user, args.sn_pass, args.sp_url, args.sp_token)
    result = b.process_event(args.event, args.user)
    b.generate_audit([result], args.audit)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
