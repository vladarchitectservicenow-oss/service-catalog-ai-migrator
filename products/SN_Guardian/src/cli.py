#!/usr/bin/env python3
"""
cli.py — SN Guardian CLI
Copyright (c) 2026 Vladimir Kapustin. License: AGPL-3.0
"""
import argparse, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))
from scanner import GuardedScriptScanner

def main():
    parser = argparse.ArgumentParser(description="SN Guardian: ServiceNow Guarded Script Migration Tool")
    parser.add_argument("--instance", default="https://dev362840.service-now.com", help="ServiceNow instance URL")
    parser.add_argument("--user", default="admin", help="Username")
    parser.add_argument("--password", default=os.environ.get("SN_PASSWORD",""), help="Password")
    parser.add_argument("--limit", type=int, default=500, help="Max scripts to scan")
    parser.add_argument("--out-dir", default="reports", help="Output directory")
    parser.add_argument("--format", choices=["html","json","both"], default="both", help="Report format")
    parser.add_argument("--generate-stubs", action="store_true", help="Generate Script Include stubs for incompatible scripts")
    parser.add_argument("--phase-info", action="store_true", help="Print current Guarded Script phase info only")
    args = parser.parse_args()

    if not args.password:
        print("ERROR: Set SN_PASSWORD env var or use --password", file=sys.stderr)
        sys.exit(1)

    scanner = GuardedScriptScanner(
        instance=args.instance,
        user=args.user,
        password=args.password,
    )

    if args.phase_info:
        phase = scanner.fetch_phase_info()
        import json
        print(json.dumps(phase, indent=2))
        return

    print(f"[SCAN] Connecting to {args.instance} ...")
    report = scanner.run(limit=args.limit)
    print(f"[OK] Scanned {report.total} scripts | Compatible: {report.compatible} | Incompatible: {report.incompatible} | Warnings: {report.warning}")

    path = scanner.save_report(report, out_dir=args.out_dir)
    print(f"[REPORT] {path}")

    if args.generate_stubs:
        stubs_dir = os.path.join(args.out_dir, "stubs")
        os.makedirs(stubs_dir, exist_ok=True)
        for s in report.scripts:
            if s.status == "INCOMPATIBLE":
                stub = scanner.generate_script_include(s)
                fname = f"GuardedScript_{s.sys_id.replace('_','')}.js"
                with open(os.path.join(stubs_dir, fname), "w") as f:
                    f.write(stub)
        print(f"[STUBS] Generated {len([s for s in report.scripts if s.status=='INCOMPATIBLE'])} Script Include stubs in {stubs_dir}")

if __name__ == "__main__":
    main()
