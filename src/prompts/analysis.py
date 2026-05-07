"""LLM prompt templates for qualitative analysis enhancement.

These prompts are used to enrich generated documents with narrative sections,
natural-language explanations, and context-aware recommendations.
"""

# Executive summary generator — takes structured data → readable overview
EXECUTIVE_SUMMARY_PROMPT = """
You are an AI Transformation Architect specializing in ServiceNow-to-AI-agent migration.
Given the following structured analysis of a ServiceNow instance, write an executive summary
in {language} suitable for CTO/VP level audience.

## Instance Data
- Catalog Items: {catalog_items_count}
- Workflows: {workflows_count}
- High Readiness Workflows: {high_readiness}
- Medium Readiness: {medium_readiness}
- Low Readiness: {low_readiness}
- Scripts with Critical Issues: {critical_scripts}
- Critical Bottlenecks: {critical_bottlenecks}
- External Integrations: {integrations_count}

## Key Findings
{key_findings}

Write a concise 3-paragraph executive summary:
1. Current state assessment (what we have)
2. Migration opportunity (what we can achieve)
3. Recommended approach (how to get there)

Keep it under 300 words. Be specific with numbers. No fluff.
"""

# Workflow narrative — explains current vs target in plain language
WORKFLOW_NARRATIVE_PROMPT = """
You are a technical architect explaining a ServiceNow workflow migration to business stakeholders.
Describe this workflow in plain {language}:

## Current Workflow
- Name: {workflow_name}
- Activities: {activity_count} ({manual_count} manual, {approval_count} approvals, {timer_count} timers)
- Health Score: {health_score}/100
- Automation Readiness: {automation_readiness}
- Key Issues: {issues}

## Target AI-Agent Design
- Agents: {agents}

Write 2-3 paragraphs:
1. What happens today (the current process from user perspective)
2. What will change with AI agents (the new experience)
3. Why this is better (concrete benefits)

Avoid jargon. Use simple examples. Keep under 200 words.
"""

# Risk description expander
RISK_DESCRIPTION_PROMPT = """
Given this structured risk data, write a clear 2-3 sentence description and mitigation
in {language} for a non-technical audience:

Risk: {risk_description}
Category: {category}
Likelihood: {likelihood}/5
Impact: {impact}/5

Output format:
Description: [clear explanation of what could go wrong]
Mitigation: [what we will do to prevent or handle this]
"""

# Training material generator for a specific role
TRAINING_ROLE_PROMPT = """
You are creating a training guide for {role}s who will interact with AI agents
instead of ServiceNow forms. Write in {language}.

## What They Do Today
{current_tasks}

## What Changes
{changes}

Write a friendly, encouraging guide with:
1. "What to expect" — how their daily work changes
2. "How to interact" — concrete examples of chatting with agents
3. "When to escalate" — clear triggers for human intervention

Keep it practical and reassuring. Under 250 words. Use bullet points.
"""

# Agent design rationale
AGENT_DESIGN_PROMPT = """
Explain the AI agent architecture for this workflow in plain {language}.
Target audience: solution architects reviewing the design.

## Workflow
- Name: {workflow_name}
- Steps: {activity_count} activities
- Current Pain Points: {pain_points}

## Proposed Agents
{agent_descriptions}

Write a paragraph on:
1. Why this specific agent topology was chosen
2. Key design trade-offs
3. What could go wrong and how we handle it

Under 200 words. Technical but readable.
"""


def get_prompt(name: str, **kwargs) -> str:
    """Get a prompt template and format it with provided kwargs.

    Args:
        name: Prompt name (executive_summary, workflow_narrative, risk_description, etc.)
        **kwargs: Format arguments for the template.

    Returns:
        Formatted prompt string.
    """
    prompts = {
        "executive_summary": EXECUTIVE_SUMMARY_PROMPT,
        "workflow_narrative": WORKFLOW_NARRATIVE_PROMPT,
        "risk_description": RISK_DESCRIPTION_PROMPT,
        "training_role": TRAINING_ROLE_PROMPT,
        "agent_design": AGENT_DESIGN_PROMPT,
    }

    template = prompts.get(name)
    if template is None:
        raise ValueError(f"Unknown prompt: {name}. Available: {list(prompts.keys())}")

    # Set defaults
    defaults = {"language": "Russian"}
    defaults.update(kwargs)

    return template.format(**defaults)
