---
title: "Terms of Reference — AI Migration for https://dev362840.service-now.com"
date: "2026-05-07 15:59:23 UTC"
version: "1.0"
status: "Draft"
---

# Terms of Reference

## 1. Project Overview

**Project Name:** AI-Powered Service Catalog Migration  
**Instance:** https://dev362840.service-now.com  
**Date:** 2026-05-07 15:59:23 UTC  

This Terms of Reference defines the scope, objectives, and governance for migrating
the ServiceNow service catalog at **https://dev362840.service-now.com** to an AI-agent-driven architecture.

## 2. Current State Summary

| Metric | Value |
|--------|-------|
| Catalog Items | 146 |
| Active Workflows | 0 |
| Script Includes | 498 |
| Business Rules | 497 |
| REST Integrations | 4 |
| Total Request History Records | 0 |



## 3. Project Objectives

1. **Automate repetitive tasks** — Replace manual approval chains and provisioning steps with AI agents.
2. **Reduce SLA breaches** — Proactive monitoring and agent-driven fulfillment.
3. **Improve user experience** — Natural-language interaction with service catalog agents.
4. **Maintain compliance** — Full audit trail retention throughout migration.
5. **Enable scalability** — Agent architecture that scales with demand.

## 4. Target State Vision

- **AI Orchestrator Agents** manage end-to-end request fulfillment.
- **Approval Agents** handle routine approvals using policy-based decisioning.
- **Provisioning Agents** execute fulfillment tasks via API integrations.
- **Notification Agents** keep users informed at every step.
- **Escalation Agents** route exceptions to human operators when confidence is low.

## 5. Stakeholders

| Role | Responsibility |
|------|---------------|
| Executive Sponsor | Strategic oversight and funding approval |
| ServiceNow Admin | Instance access and technical configuration |
| Integration Architect | API design and connectivity |
| Security Officer | Access control and audit compliance |
| Change Manager | CAB approvals and rollout coordination |
| End Users | Service requestors and approvers |

## 6. Success Metrics

| Metric | Baseline | Target |
|--------|----------|--------|
| SLA Compliance Rate | TBD | ≥ 95% |
| Manual Steps per Request | 0 | ≤ 2 |
| Average Fulfillment Time | TBD | ≤ 2 hrs |
| Agent Automation Rate | 0% | ≥ 80% |
| User Satisfaction | TBD | ≥ 4.5/5 |

## 7. Key Assumptions

1. ServiceNow instance remains accessible throughout the migration.
2. API rate limits are sufficient for agent-driven operations.
3. Existing integrations remain stable and well-documented.
4. Staff are available for training and parallel-run oversight.
5. LLM inference latency is within acceptable thresholds (< 5s per decision).

## 8. Constraints

- No disruption to production catalog items during migration.
- All agent decisions must be auditable.
- Human-in-the-loop for high-impact actions (P1 items, security changes).
- On-premises data must not leave approved environments.

## 9. Deliverables

1. Agent Architecture Designs (per workflow)
2. Migration Roadmap with phased rollout plan
3. Risk Register with mitigations
4. Technical Specification
5. Training Plan for all user roles
6. Production-ready Agent Deployment