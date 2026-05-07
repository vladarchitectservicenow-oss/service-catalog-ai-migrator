"""Shared pytest fixtures for the full pipeline integration tests."""

import pytest

from src.models import DiscoveryResult, AnalysisResult
from src.analyzer.workflow_health import WorkflowHealthAnalyzer
from src.analyzer.script_auditor import ScriptAuditor
from src.analyzer.integration_mapper import IntegrationMapper
from src.analyzer.bottleneck_finder import BottleneckFinder
from tests.fixtures.sn_responses import MockServiceNowData


# ---------------------------------------------------------------------------
# Data factory fixture
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def mock_data():
    """Return the MockServiceNowData factory class."""
    return MockServiceNowData()


# ---------------------------------------------------------------------------
# Discovery fixture (no analysis — raw discovery data)
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def mock_discovery(mock_data):
    """Construct a complete DiscoveryResult from mock data."""
    return DiscoveryResult(
        instance_url="https://test.service-now.com",
        catalog_items=mock_data.catalog_items(),
        workflows=mock_data.workflows(),
        script_includes=mock_data.script_includes(),
        business_rules=mock_data.business_rules(),
        integrations=mock_data.integrations(),
        history=mock_data.history(),
    )


# ---------------------------------------------------------------------------
# Analysis fixture — runs all four analyzers on the discovery data
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def mock_analysis(mock_discovery):
    """Run the full analysis pipeline on mock discovery data.

    Returns an AnalysisResult containing workflow health, script audits,
    integration map info (via bottlenecks), and bottleneck records.
    """
    workflow_health = WorkflowHealthAnalyzer().analyze(mock_discovery)
    script_audits = ScriptAuditor().audit(mock_discovery)
    bottlenecks = BottleneckFinder().find_bottlenecks(mock_discovery)

    return AnalysisResult(
        discovery=mock_discovery,
        workflow_health=workflow_health,
        script_audits=script_audits,
        bottlenecks=bottlenecks,
    )


# ---------------------------------------------------------------------------
# Per-function fixtures (reset each test) for isolation-sensitive tests
# ---------------------------------------------------------------------------

@pytest.fixture
def fresh_discovery(mock_data):
    """Fresh copy of discovery data for mutation-sensitive tests."""
    return DiscoveryResult(
        instance_url="https://test.service-now.com",
        catalog_items=mock_data.catalog_items(),
        workflows=mock_data.workflows(),
        script_includes=mock_data.script_includes(),
        business_rules=mock_data.business_rules(),
        integrations=mock_data.integrations(),
        history=mock_data.history(),
    )


@pytest.fixture
def fresh_analysis(fresh_discovery):
    """Fresh copy of analysis for mutation-sensitive tests."""
    workflow_health = WorkflowHealthAnalyzer().analyze(fresh_discovery)
    script_audits = ScriptAuditor().audit(fresh_discovery)
    bottlenecks = BottleneckFinder().find_bottlenecks(fresh_discovery)

    return AnalysisResult(
        discovery=fresh_discovery,
        workflow_health=workflow_health,
        script_audits=script_audits,
        bottlenecks=bottlenecks,
    )
