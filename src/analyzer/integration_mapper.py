"""Integration Mapper — discovers and categorizes all external system integrations.

Scans REST integrations, script includes, and business rules in a DiscoveryResult
to build a comprehensive integration map with categories, risks, and cross-references.
"""

import re
from typing import Optional

from ..models import (
    BusinessRule,
    DiscoveryResult,
    RESTIntegration,
    ScriptInclude,
)


# ---------------------------------------------------------------------------
# Category constants
# ---------------------------------------------------------------------------

CATEGORY_AD_LDAP = "AD/LDAP"
CATEGORY_EMAIL = "email"
CATEGORY_ERP_SAP = "ERP/SAP"
CATEGORY_CLOUD = "cloud"
CATEGORY_CUSTOM_API = "custom API"
CATEGORY_DATABASE = "database"
CATEGORY_MIDDLEWARE = "middleware"
CATEGORY_UNKNOWN = "unknown"

# Known external system patterns (domain / keyword → category)
_DOMAIN_CATEGORY_MAP: dict[str, str] = {
    "ldap": CATEGORY_AD_LDAP,
    "activedirectory": CATEGORY_AD_LDAP,
    "ad.": CATEGORY_AD_LDAP,
    "azuread": CATEGORY_AD_LDAP,
    "okta": CATEGORY_AD_LDAP,
    "saml": CATEGORY_AD_LDAP,
    "sso": CATEGORY_AD_LDAP,
    "mailgun": CATEGORY_EMAIL,
    "sendgrid": CATEGORY_EMAIL,
    "smtp": CATEGORY_EMAIL,
    "exchange": CATEGORY_EMAIL,
    "office365": CATEGORY_EMAIL,
    "outlook": CATEGORY_EMAIL,
    "gmail": CATEGORY_EMAIL,
    "ses.": CATEGORY_EMAIL,
    "sap": CATEGORY_ERP_SAP,
    "erp": CATEGORY_ERP_SAP,
    "successfactors": CATEGORY_ERP_SAP,
    "concur": CATEGORY_ERP_SAP,
    "ariba": CATEGORY_ERP_SAP,
    "salesforce": CATEGORY_CLOUD,
    "workday": CATEGORY_CLOUD,
    "servicenow": CATEGORY_CLOUD,
    "jira": CATEGORY_CLOUD,
    "slack": CATEGORY_CLOUD,
    "teams": CATEGORY_CLOUD,
    "aws": CATEGORY_CLOUD,
    "azure": CATEGORY_CLOUD,
    "gcp": CATEGORY_CLOUD,
    "googleapis": CATEGORY_CLOUD,
    "github": CATEGORY_CLOUD,
    "gitlab": CATEGORY_CLOUD,
    "pagerduty": CATEGORY_CLOUD,
    "datadog": CATEGORY_CLOUD,
    "splunk": CATEGORY_CLOUD,
    "twilio": CATEGORY_CLOUD,
    "stripe": CATEGORY_CLOUD,
}

# Regex patterns for integration references in script content
_SCRIPT_INTEGRATION_PATTERNS: dict[str, re.Pattern] = {
    "ldap_ad": re.compile(
        r"\b(ldap|LDAP|Ldap|ActiveDirectory|AD\s*\.|ad\s*\.)", re.IGNORECASE
    ),
    "email": re.compile(
        r"\b(Mailgun|SendGrid|smtp|SMTP|sendmail|nodemailer|email\s*client|EmailNotification)",
        re.IGNORECASE,
    ),
    "database": re.compile(
        r"\bGlideRecord\s*\(\s*['\"]u_|external\s+table|"
        r"DataObject\b|gr\.(get|addQuery|query)\b",
        re.IGNORECASE,
    ),
    "middleware": re.compile(
        r"\b(JMS|MQ|Kafka|RabbitMQ|ActiveMQ|Tibco|WebSphere|BizTalk|"
        r"MuleSoft|TIBCO|Boomi|Dell\s*Boomi)",
        re.IGNORECASE,
    ),
    "rest": re.compile(
        r"\b(RESTMessageV2|SOAPMessageV2|GlideHTTPRequest|HttpRequest|"
        r"RESTAPIRequest|RESTAPIRequestBody|JSONWebToken)",
        re.IGNORECASE,
    ),
}

# Category display labels for each script pattern
_PATTERN_CATEGORY_MAP: dict[str, str] = {
    "ldap_ad": CATEGORY_AD_LDAP,
    "email": CATEGORY_EMAIL,
    "database": CATEGORY_DATABASE,
    "middleware": CATEGORY_MIDDLEWARE,
    "rest": CATEGORY_CUSTOM_API,
}

# Risk keywords / phrases that indicate unmonitored or deprecated integrations
_RISK_WARNING_PATTERNS: list[tuple[str, str]] = [
    ("basic auth", "Integration using Basic Auth — insecure, migrate to OAuth2/token-based"),
    ("password", "Hardcoded credential reference detected — use secrets manager"),
    ("deprecated", "Deprecated endpoint or API version referenced"),
    ("http://", "Unencrypted HTTP endpoint — use HTTPS"),
    ("v1", "API v1 may be deprecated — check for newer versions"),
    ("api key", "API key in code — move to secure credential store"),
    ("tls 1.0", "Outdated TLS version referenced"),
    ("tls 1.1", "Outdated TLS version referenced"),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _categorize_endpoint(endpoint: str, name: str = "") -> str:
    """Return the integration category for a given endpoint URL / name.

    Checks against the domain→category map, falling back to heuristics
    based on the endpoint format.
    """
    text = f"{endpoint or ''} {name or ''}".lower()

    for keyword, category in _DOMAIN_CATEGORY_MAP.items():
        if keyword in text:
            return category

    # Heuristic fallback
    ep_lower = (endpoint or "").lower()
    if "/api/" in ep_lower or "rest" in ep_lower or "graphql" in ep_lower:
        return CATEGORY_CUSTOM_API
    if "soap" in ep_lower:
        return CATEGORY_CUSTOM_API
    if "queue" in ep_lower or "broker" in ep_lower:
        return CATEGORY_MIDDLEWARE
    if "db" in ep_lower or "database" in ep_lower or "sql" in ep_lower:
        return CATEGORY_DATABASE

    return CATEGORY_UNKNOWN


def _extract_system_name(endpoint: str) -> str:
    """Extract a human-readable external system name from an endpoint URL."""
    if not endpoint:
        return "unknown"

    # Try to extract hostname
    host_match = re.search(r"://([^/:\s]+)", endpoint)
    if not host_match:
        # Maybe just a hostname string
        cleaned = endpoint.strip().strip("/").split("/")[0]
        if "." in cleaned:
            host_match = re.match(r"([^/:\s]+)", cleaned)
            if host_match:
                return host_match.group(1)

    if host_match:
        host = host_match.group(1)
        # Strip common subdomains / TLDs for a cleaner name
        parts = host.split(".")
        if len(parts) >= 3:
            # e.g. api.staging.company.com → company
            return parts[-2].capitalize()
        if len(parts) == 2:
            return parts[0].capitalize()
        return host

    return endpoint[:30]


def _scan_script_for_integrations(
    script: str,
) -> dict[str, bool]:
    """Check a script body for integration references.

    Returns a dict mapping category → whether that category was detected.
    """
    if not script:
        return {}

    found: dict[str, bool] = {}

    for pattern_key, regex in _SCRIPT_INTEGRATION_PATTERNS.items():
        if regex.search(script):
            category = _PATTERN_CATEGORY_MAP.get(pattern_key, pattern_key)
            found[category] = True

    return found


def _collect_script_integration_categories(
    script_includes: list[ScriptInclude],
    business_rules: list[BusinessRule],
) -> dict[str, bool]:
    """Aggregate all integration categories referenced in any script."""
    all_categories: dict[str, bool] = {}

    for si in script_includes:
        found = _scan_script_for_integrations(si.script or "")
        for cat in found:
            all_categories[cat] = True

    for br in business_rules:
        found = _scan_script_for_integrations(br.script or "")
        for cat in found:
            all_categories[cat] = True

    return all_categories


def _build_risk_summary(
    integrations: list[dict],
    category_counts: dict[str, int],
    script_categories: dict[str, bool],
) -> str:
    """Build a risk summary with warnings about unmonitored/deprecated integrations."""
    warnings: list[str] = []

    # Check for deprecated/insecure patterns in endpoint URLs
    deprecated_count = 0
    for integ in integrations:
        ep = (integ.get("endpoint") or "").lower()
        name = (integ.get("name") or "").lower()
        combined = f"{ep} {name}"
        for keyword, message in _RISK_WARNING_PATTERNS:
            if keyword in combined:
                warnings.append(f"  - {integ.get('name', 'unnamed')}: {message}")
                deprecated_count += 1
                break  # one warning per integration

    # Count inactive integrations
    inactive_count = sum(1 for i in integrations if not i.get("active", True))

    # Unmonitored: integrations found only in scripts, not in REST config
    script_only = {cat for cat in script_categories if cat not in category_counts}
    unmonitored_count = 0
    if CATEGORY_DATABASE in script_only:
        warnings.append("  - Database integrations (GlideRecord to external tables) "
                        "exist only in scripts — not tracked in REST configuration")
        unmonitored_count += 1
    if CATEGORY_MIDDLEWARE in script_only:
        warnings.append("  - Middleware integrations (JMS/MQ/Kafka) found in scripts "
                        "but not in REST config — may be unmonitored")
        unmonitored_count += 1
    if CATEGORY_AD_LDAP in script_only:
        warnings.append("  - AD/LDAP integration referenced in scripts but not "
                        "configured as a REST endpoint")
        unmonitored_count += 1

    # Unknown category count
    unknown_count = category_counts.get(CATEGORY_UNKNOWN, 0)
    if unknown_count > 0:
        warnings.append(f"  - {unknown_count} integration(s) with unknown/uncategorized "
                        f"endpoints — manual review required for migration planning")

    # Build summary
    summary_parts: list[str] = []
    if warnings:
        summary_parts.append(f"Warnings ({len(warnings)} issues found):")
        summary_parts.extend(warnings)
    else:
        summary_parts.append("No significant risk warnings detected.")

    if inactive_count > 0:
        summary_parts.append(f"Note: {inactive_count} integration(s) are inactive — "
                             f"verify whether they can be removed.")

    if deprecated_count > 0:
        summary_parts.insert(
            0,
            f"CRITICAL: {deprecated_count} integration(s) use deprecated/insecure patterns. "
            f"Address before migration."
        )

    return "\n".join(summary_parts)


# ---------------------------------------------------------------------------
# IntegrationMapper
# ---------------------------------------------------------------------------


class IntegrationMapper:
    """Maps and categorizes all external system integrations.

    Scans REST message records and script content to build a comprehensive
    inventory of every integration touchpoint.

    Public method:
        map_integrations(discovery_result) -> dict
    """

    def map_integrations(self, discovery_result: DiscoveryResult) -> dict:
        """Produce a complete integration map from the discovery result.

        Args:
            discovery_result: Complete discovery payload including REST
                              integrations, script includes, and business rules.

        Returns:
            Dict with keys:
                - "integrations": list of {name, endpoint, method, category,
                  referenced_in_scripts, active}
                - "categories": {category_name: count}
                - "systems": list of unique external system names
                - "risk_summary": str with risk warnings
        """
        # ---- Scan script content for integration patterns ----
        script_categories = _collect_script_integration_categories(
            discovery_result.script_includes,
            discovery_result.business_rules,
        )

        # ---- Process REST integration records ----
        integrations: list[dict] = []
        category_counts: dict[str, int] = {}
        systems: set[str] = set()

        for integ in discovery_result.integrations:
            category = _categorize_endpoint(integ.endpoint, integ.name)
            system = _extract_system_name(integ.endpoint)

            category_counts[category] = category_counts.get(category, 0) + 1

            if system and system != "unknown":
                systems.add(system)

            entry: dict = {
                "name": integ.name,
                "endpoint": integ.endpoint,
                "method": integ.http_method,
                "category": category,
                "referenced_in_scripts": category in script_categories,
                "active": integ.active,
                "system": system,
            }
            integrations.append(entry)

        # ---- Add script-only categories to counts (for reporting) ----
        for cat in script_categories:
            if cat not in category_counts:
                category_counts[cat] = 0  # referenced in scripts but not in REST config

        # ---- Build risk summary ----
        risk_summary = _build_risk_summary(integrations, category_counts, script_categories)

        return {
            "integrations": sorted(integrations, key=lambda i: (i["category"], i["name"])),
            "categories": dict(sorted(category_counts.items())),
            "systems": sorted(systems),
            "risk_summary": risk_summary,
        }
