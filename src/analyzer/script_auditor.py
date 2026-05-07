"""Script Auditor — checks ServiceNow scripts for quality and AI-agent compatibility.

Scans every ScriptInclude and BusinessRule in a DiscoveryResult, identifies
patterns that block or complicate migration to an external AI-agent architecture,
and produces a sorted list of ScriptAuditResult records.
"""

import re
import hashlib
from typing import Optional

from ..models import (
    BusinessRule,
    DiscoveryResult,
    ScriptAuditResult,
    ScriptInclude,
)


# ---------------------------------------------------------------------------
# Severity ordering (used for sorting)
# ---------------------------------------------------------------------------
SEVERITY_ORDER: dict[str, int] = {
    "critical": 0,
    "high": 1,
    "medium": 2,
    "low": 3,
    "info": 4,
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

class ScriptAuditor:
    """Audits ServiceNow scripts for quality and AI-agent migration readiness.

    Public method:
        audit(discovery_result) -> list[ScriptAuditResult]
    """

    # Large-script threshold (lines)
    LARGE_SCRIPT_LINES = 500

    # Minimum number of lines before flagging "missing error handling"
    MIN_LINES_FOR_ERROR_CHECK = 10

    # Minimum function body length (chars) before considering for duplication
    MIN_FUNC_BODY_FOR_DUPE = 50

    # Magic number threshold — any numeric literal used in certain contexts
    # (e.g. sleep, delay, retry) will be flagged.
    MAGIC_CONTEXTS = (
        "sleep", "wait", "delay", "retry", "limit", "threshold",
        "timeout", "max", "min",
    )

    # ------------------------------------------------------------------
    # Core audit entry-point
    # ------------------------------------------------------------------

    def audit(self, discovery_result: DiscoveryResult) -> list[ScriptAuditResult]:
        """Run the full audit across all scripts in the discovery result.

        Includes per-script pattern checks and cross-script duplicate
        logic detection.

        Args:
            discovery_result: Complete discovery payload including
                              script_includes and business_rules.

        Returns:
            List of ScriptAuditResult sorted by severity (critical first),
            grouped by script_type.
        """
        results: list[ScriptAuditResult] = []
        raw_scripts: list[tuple[int, str, str]] = []  # (result_idx, script_type, raw)

        # ---- Script Includes ----
        for si in discovery_result.script_includes:
            idx = len(results)
            raw_scripts.append((idx, "script_include", si.script or ""))
            result = self._audit_one_script(
                sys_id=si.sys_id,
                name=si.name,
                script_type="script_include",
                script=si.script or "",
            )
            results.append(result)

        # ---- Business Rules ----
        for br in discovery_result.business_rules:
            idx = len(results)
            raw_scripts.append((idx, "business_rule", br.script or ""))
            result = self._audit_one_script(
                sys_id=br.sys_id,
                name=br.name,
                script_type="business_rule",
                script=br.script or "",
            )
            results.append(result)

        # ---- Cross-script duplicate detection ----
        self._flag_duplicates(results, raw_scripts)

        # Sort: severity (critical → info), then script_type, then name
        results.sort(
            key=lambda r: (
                SEVERITY_ORDER.get(r.severity, 99),
                0 if r.script_type == "script_include" else 1,
                r.name.lower(),
            )
        )

        return results

    # ------------------------------------------------------------------
    # Per-script analysis
    # ------------------------------------------------------------------

    def _audit_one_script(
        self,
        sys_id: str,
        name: str,
        script_type: str,
        script: str,
    ) -> ScriptAuditResult:
        """Run all checks on a single script and return a result record."""
        issues: list[dict] = []
        lines = script.split("\n") if script else []

        if not script or not script.strip():
            return ScriptAuditResult(
                sys_id=sys_id,
                name=name,
                script_type=script_type,
                issues=issues,
                agent_compatible=True,
                needs_refactor=False,
                severity="info",
            )

        # ---- CRITICAL checks ----
        self._check_gliderecord(lines, issues)
        self._check_gs_log(lines, issues)
        self._check_hardcoded_sys_ids(lines, issues)
        self._check_hardcoded_email_url(lines, issues)

        # ---- HIGH checks ----
        self._check_sync_http(lines, issues)
        self._check_direct_table_writes(lines, issues)
        self._check_missing_error_handling(lines, script, issues)
        self._check_large_script(lines, issues)

        # ---- MEDIUM checks ----
        self._check_es5_patterns(lines, script, issues)
        self._check_undocumented_conditions(lines, issues)

        # ---- LOW / INFO checks ----
        self._check_missing_jsdoc(lines, script, issues)
        self._check_magic_numbers(lines, issues)

        # ---- Derive summary fields ----
        max_sev = self._max_severity(issues)
        has_critical = any(i["severity"] == "critical" for i in issues)
        has_high = any(i["severity"] == "high" for i in issues)

        return ScriptAuditResult(
            sys_id=sys_id,
            name=name,
            script_type=script_type,
            issues=issues,
            agent_compatible=not has_critical,
            needs_refactor=has_critical or has_high,
            severity=max_sev,
        )

    # ------------------------------------------------------------------
    # CRITICAL checks
    # ------------------------------------------------------------------

    @staticmethod
    def _check_gliderecord(lines: list[str], issues: list[dict]) -> None:
        """Detect GlideRecord / server-side-only references."""
        patterns: list[tuple[str, str]] = [
            (r"\bGlideRecord\b", "gliderecord"),
            (r"\bg_form\b", "gliderecord"),
            # current used as an object:  current.field  current.update()  current['field']
            (r"\bcurrent\s*[\.\[\(]", "gliderecord"),
            (r"\bprevious\s*[\.\[\(]", "gliderecord"),
        ]

        for regex, category in patterns:
            for idx, line in enumerate(lines, start=1):
                if re.search(regex, line):
                    issues.append({
                        "severity": "critical",
                        "category": category,
                        "description": (
                            f"Server-side GlideRecord reference "
                            f"('{re.search(regex, line).group(0).strip()}') "
                            f"needs REST API refactoring for external agents"
                        ),
                        "line": idx,
                    })

    @staticmethod
    def _check_gs_log(lines: list[str], issues: list[dict]) -> None:
        """Detect gs.log / gs.info / gs.warn / gs.error — unstructured logging."""
        pattern = r"\bgs\.(log|print|info|warn|error|debug)\s*\("
        for idx, line in enumerate(lines, start=1):
            match = re.search(pattern, line)
            if match:
                issues.append({
                    "severity": "critical",
                    "category": "logging",
                    "description": (
                        f"Unstructured logging via gs.{match.group(1)}() — "
                        f"replace with structured logging for external agents"
                    ),
                    "line": idx,
                })

    @staticmethod
    def _check_hardcoded_sys_ids(lines: list[str], issues: list[dict]) -> None:
        """Flag hardcoded 32-char hex sys_ids in string literals."""
        # Look for 32-character hex strings inside quotes
        pattern = r"""['\"]([0-9a-fA-F]{32})['\"]"""
        for idx, line in enumerate(lines, start=1):
            for match in re.finditer(pattern, line):
                # Skip if it's clearly a variable reference / template literal
                issues.append({
                    "severity": "critical",
                    "category": "hardcoded_id",
                    "description": (
                        f"Hardcoded sys_id '{match.group(1)}' — "
                        f"extract to configuration or environment variable"
                    ),
                    "line": idx,
                })

    @staticmethod
    def _check_hardcoded_email_url(lines: list[str], issues: list[dict]) -> None:
        """Detect hardcoded email addresses and URLs."""
        email_pat = r"""['\"]([^'\"]*[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}[^'\"]*)['\"]"""
        url_pat = r"""['\"](https?://[^\s'\"]+)['\"]"""

        for idx, line in enumerate(lines, start=1):
            # Skip comment lines
            stripped = line.strip()
            if stripped.startswith("//") or stripped.startswith("*"):
                continue

            for match in re.finditer(email_pat, line):
                issues.append({
                    "severity": "critical",
                    "category": "hardcoded_config",
                    "description": (
                        f"Hardcoded email '{match.group(1)}' — "
                        f"move to configuration"
                    ),
                    "line": idx,
                })

            for match in re.finditer(url_pat, line):
                issues.append({
                    "severity": "critical",
                    "category": "hardcoded_config",
                    "description": (
                        f"Hardcoded URL '{match.group(1)}' — "
                        f"may change; move to configuration"
                    ),
                    "line": idx,
                })

    # ------------------------------------------------------------------
    # HIGH checks
    # ------------------------------------------------------------------

    @staticmethod
    def _check_sync_http(lines: list[str], issues: list[dict]) -> None:
        """Detect synchronous HTTP requests."""
        patterns = [
            (r"\bGlideHTTPRequest\b", "GlideHTTPRequest"),
            (r"\bRESTMessageV2\b", "RESTMessageV2"),
            (r"\bSOAPMessageV2\b", "SOAPMessageV2"),
        ]
        for regex, label in patterns:
            for idx, line in enumerate(lines, start=1):
                if re.search(regex, line):
                    issues.append({
                        "severity": "high",
                        "category": "sync_http",
                        "description": (
                            f"Synchronous HTTP call ({label}) — "
                            f"agents need async/event-driven patterns"
                        ),
                        "line": idx,
                    })

    @staticmethod
    def _check_direct_table_writes(lines: list[str], issues: list[dict]) -> None:
        """Detect direct database writes without audit trail."""
        write_patterns = [
            (r"\bcurrent\.(update|insert|delete_record)\s*\(", "current"),
            (r"\b(\w+)\.(update|insert|delete_record)\s*\(", "GlideRecord"),
            (r"\b(\w+)\.setValue\s*\(", "GlideRecord"),
        ]
        for regex, label in write_patterns:
            for idx, line in enumerate(lines, start=1):
                match = re.search(regex, line)
                if match:
                    issues.append({
                        "severity": "high",
                        "category": "direct_write",
                        "description": (
                            f"Direct table write ({label}.{match.group(2) if match.lastindex and match.lastindex >= 2 else 'write'}) — "
                            f"needs audit trail for external agents"
                        ),
                        "line": idx,
                    })

    def _check_missing_error_handling(
        self, lines: list[str], script: str, issues: list[dict]
    ) -> None:
        """Flag scripts that perform risky operations without try/catch."""
        if len(lines) < self.MIN_LINES_FOR_ERROR_CHECK:
            return

        has_try_catch = bool(re.search(r"\btry\b", script) and re.search(r"\bcatch\b", script))

        # Only flag if the script contains risky operations
        has_risky = (
            re.search(r"\bGlideRecord\b", script)
            or re.search(r"\bGlideHTTPRequest\b|\bRESTMessageV2\b", script)
            or re.search(r"\.(update|insert|delete_record)\s*\(", script)
        )

        if has_risky and not has_try_catch:
            issues.append({
                "severity": "high",
                "category": "error_handling",
                "description": (
                    "Script performs risky operations (DB/HTTP) without "
                    "try/catch error handling"
                ),
                "line": 1,
            })

    def _check_large_script(self, lines: list[str], issues: list[dict]) -> None:
        """Flag scripts larger than the threshold."""
        if len(lines) > self.LARGE_SCRIPT_LINES:
            issues.append({
                "severity": "high",
                "category": "size",
                "description": (
                    f"Script is {len(lines)} lines (>{self.LARGE_SCRIPT_LINES}) — "
                    f"difficult to migrate; consider splitting"
                ),
                "line": 1,
            })

    # ------------------------------------------------------------------
    # MEDIUM checks
    # ------------------------------------------------------------------

    def _check_es5_patterns(
        self, lines: list[str], script: str, issues: list[dict]
    ) -> None:
        """Detect ES5-only patterns suggesting no ES6+ usage."""
        var_count = len(re.findall(r"\bvar\s+\w+", script))
        has_let_const = bool(re.search(r"\b(let|const)\s+\w+", script))
        has_arrow = bool(re.search(r"=>", script))
        has_template = bool(re.search(r"`[^`]*\$\{[^}]+\}[^`]*`", script))

        if var_count > 0 and not has_let_const:
            # ES5 pattern found — find first occurrence for line ref
            for idx, line in enumerate(lines, start=1):
                if re.search(r"\bvar\s+\w+", line):
                    issues.append({
                        "severity": "medium",
                        "category": "es5",
                        "description": (
                            f"ES5 'var' usage ({var_count} occurrences, "
                            f"no let/const) — recommend ES6+ for readability"
                        ),
                        "line": idx,
                    })
                    break

        # Also flag if predominantly function keyword, no arrow functions
        func_kw_count = len(re.findall(r"\bfunction\s+\w+\s*\(", script))
        if func_kw_count >= 3 and not has_arrow:
            for idx, line in enumerate(lines, start=1):
                if re.search(r"\bfunction\s+\w+\s*\(", line):
                    issues.append({
                        "severity": "medium",
                        "category": "es5",
                        "description": (
                            f"Only 'function' keyword used ({func_kw_count} functions, "
                            f"no arrow functions) — consider ES6+ arrow functions"
                        ),
                        "line": idx,
                    })
                    break

    @staticmethod
    def _check_undocumented_conditions(
        lines: list[str], issues: list[dict]
    ) -> None:
        """Flag complex conditions that lack inline comments."""
        # Look for if/while statements with compound conditions
        complex_cond = re.compile(
            r"(if|while|else\s+if)\s*\(.*?(&&|\|\|).*?\)"
        )
        for idx, line in enumerate(lines, start=1):
            if complex_cond.search(line):
                # Check if there's a comment on the same or preceding line
                has_comment = (
                    "//" in line
                    or (idx > 1 and "//" in lines[idx - 2])
                    or "/**" in (lines[idx - 2] if idx > 1 else "")
                )
                if not has_comment:
                    issues.append({
                        "severity": "medium",
                        "category": "documentation",
                        "description": (
                            "Complex compound condition without explanatory comment"
                        ),
                        "line": idx,
                    })

    # ------------------------------------------------------------------
    # LOW / INFO checks
    # ------------------------------------------------------------------

    @staticmethod
    def _check_missing_jsdoc(
        lines: list[str], script: str, issues: list[dict]
    ) -> None:
        """Flag public functions that lack JSDoc /** ... */ comments."""
        # Find function definitions
        func_pattern = re.compile(
            r"^\s*(function\s+(\w+)\s*\(|(\w+)\s*[:=]\s*function\s*\(|(\w+)\s*[:=]\s*\(.*?\)\s*=>)",
            re.MULTILINE,
        )

        for idx, line in enumerate(lines, start=1):
            match = func_pattern.match(line)
            if not match:
                # Also check for prototype method assignments
                proto_match = re.match(r"^\s*(\w+)\.prototype\.(\w+)\s*=\s*function", line)
                if proto_match:
                    func_name = f"{proto_match.group(1)}.{proto_match.group(2)}"
                else:
                    continue
            else:
                # Extract function name from any of the capturing groups
                func_name = (
                    match.group(2) or match.group(3) or match.group(4) or "anonymous"
                )

            # Skip private functions (prefixed with _)
            if func_name.startswith("_"):
                continue

            # Check preceding lines for JSDoc
            has_jsdoc = False
            lookback = min(idx - 1, 10)
            for back in range(1, lookback + 1):
                prev = lines[idx - 1 - back].strip()
                if "/**" in prev or "@param" in prev or "@returns" in prev:
                    has_jsdoc = True
                    break
                if prev == "" or prev.startswith("//"):
                    continue
                # Hit a non-comment, non-blank line → no JSDoc
                if not prev.startswith("*") and not prev.startswith("/*"):
                    break

            if not has_jsdoc:
                issues.append({
                    "severity": "low",
                    "category": "documentation",
                    "description": (
                        f"Public function '{func_name}' missing JSDoc comment"
                    ),
                    "line": idx,
                })

    @classmethod
    def _check_magic_numbers(
        cls, lines: list[str], issues: list[dict]
    ) -> None:
        """Flag numeric literals that appear to be magic numbers."""
        # Find numbers used in comparisons or assignments that look like
        # configuration values (not 0, 1, -1, array indices, etc.)
        magic_pattern = re.compile(
            r"(?:==|!=|<=|>=|<|>|\b(?:sleep|wait|delay|retry|limit|threshold|timeout|max|min))\s*[\"']?\s*(\d{2,})\b"
        )

        for idx, line in enumerate(lines, start=1):
            for match in magic_pattern.finditer(line):
                num = int(match.group(1))
                # Skip common constants
                if num in (100, 200, 400, 500, 1000, 1024, 2048):
                    continue
                # Flag as magic number
                issues.append({
                    "severity": "low",
                    "category": "magic_number",
                    "description": (
                        f"Magic number {num} used without named constant"
                    ),
                    "line": idx,
                })

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _max_severity(issues: list[dict]) -> str:
        """Return the maximum severity level from the issues list."""
        if not issues:
            return "info"
        for sev in ("critical", "high", "medium", "low"):
            if any(i["severity"] == sev for i in issues):
                return sev
        return "info"

    # ------------------------------------------------------------------
    # Duplicate-logic detection
    # ------------------------------------------------------------------

    def _flag_duplicates(
        self,
        results: list[ScriptAuditResult],
        raw_scripts: list[tuple[int, str, str]],
    ) -> None:
        """Extract function bodies from all scripts and flag duplicates."""
        func_re = re.compile(
            r"""^\s*(?:function\s+(\w+)\s*\([^)]*\)\s*\{|(\w+)\s*[:=]\s*function\s*\([^)]*\)\s*\{|(\w+)\s*[:=]\s*\([^)]*\)\s*=>\s*\{)""",
            re.MULTILINE,
        )

        # Build: { normalized_hash: [(result_idx, func_name, line), ...] }
        hash_map: dict[str, list[tuple[int, str, int]]] = {}

        for ri, _stype, script in raw_scripts:
            if not script:
                continue
            lines = script.split("\n")
            for idx, line in enumerate(lines):
                match = func_re.match(line)
                if not match:
                    continue
                func_name = match.group(1) or match.group(2) or match.group(3) or "anonymous"
                if func_name.startswith("_"):
                    continue

                # Extract the function body (naive brace-matching)
                body = self._extract_function_body(lines, idx)
                if len(body) < self.MIN_FUNC_BODY_FOR_DUPE:
                    continue

                normalized = self._normalize_body(body)
                body_hash = hashlib.sha256(normalized.encode("utf-8")).hexdigest()

                hash_map.setdefault(body_hash, []).append(
                    (ri, func_name, idx + 1)
                )

        # Flag duplicates (more than one script has the same body)
        for entries in hash_map.values():
            if len(entries) < 2:
                continue
            # All entries share the same body — flag each
            for ri, func_name, line_num in entries:
                results[ri].issues.append({
                    "severity": "medium",
                    "category": "duplicate_logic",
                    "description": (
                        f"Function '{func_name}' has duplicate logic in "
                        f"{len(entries) - 1} other script(s) — consider extracting "
                        f"to a shared Script Include"
                    ),
                    "line": line_num,
                })
                # Update severity if needed
                sevs = [i["severity"] for i in results[ri].issues]
                for s in ("critical", "high", "medium", "low"):
                    if s in sevs:
                        results[ri].severity = s
                        break
                else:
                    results[ri].severity = "info"
                results[ri].needs_refactor = results[ri].needs_refactor or True

    @staticmethod
    def _extract_function_body(lines: list[str], start_idx: int) -> str:
        """Naively extract function body from the opening brace.

        Args:
            lines: All script lines.
            start_idx: Index of the line containing the function signature.

        Returns:
            The body text between { and matching }.
        """
        # Find the opening brace
        combined = "\n".join(lines[start_idx:])
        brace_start = combined.find("{")
        if brace_start == -1:
            return ""

        depth = 0
        body_start = None
        body_end = None

        for i, ch in enumerate(combined[brace_start:], start=brace_start):
            if ch == "{":
                if depth == 0:
                    body_start = i + 1
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    body_end = i
                    break

        if body_start is not None and body_end is not None:
            return combined[body_start:body_end]
        return ""

    @staticmethod
    def _normalize_body(body: str) -> str:
        """Normalize a function body for comparison.

        Strips comments, collapses whitespace, removes variable names.
        """
        # Remove single-line comments
        body = re.sub(r"//[^\n]*", "", body)
        # Remove multi-line comments
        body = re.sub(r"/\*.*?\*/", "", body, flags=re.DOTALL)
        # Collapse whitespace
        body = re.sub(r"\s+", " ", body).strip()
        # Replace variable names with placeholders (heuristic)
        body = re.sub(r"\b(set|get)\w+\b", "FUNC_CALL", body)
        body = re.sub(r"gr\b", "GR", body)
        return body
