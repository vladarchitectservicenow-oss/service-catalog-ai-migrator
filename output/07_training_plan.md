---
title: "Training Plan — AI-Powered Service Catalog"
date: "2026-05-07 15:59:23 UTC"
instance: "https://dev362840.service-now.com"
---

# Training Plan

## 1. Overview

This training plan prepares all user roles for the transition to an AI-agent-powered
service catalog at **https://dev362840.service-now.com**. Training is role-based and delivered in phases
aligned with the migration roadmap.

## 2. Role-Based Curriculum

### 2.1 End Users (Requestors)

**Who:** All employees who submit service catalog requests.  
**Duration:** 2 hours  
**Delivery:** Instructor-led workshop + self-paced video  

| Module | Topic | Duration | Format |
|--------|-------|----------|--------|
| EU-01 | Introduction to AI Agents | 20 min | Video |
| EU-02 | Submitting Requests via Agent Chat | 30 min | Hands-on |
| EU-03 | Understanding Agent Responses | 20 min | Workshop |
| EU-04 | Escalating When Needed | 20 min | Hands-on |
| EU-05 | FAQ & Troubleshooting | 30 min | Q&A |

**Learning Objectives:**
- Submit a service request using natural language
- Interpret agent status updates
- Recognize when and how to escalate to a human

### 2.2 Approvers

**Who:** Managers and team leads who approve service requests.  
**Duration:** 1.5 hours  
**Delivery:** Instructor-led workshop  

| Module | Topic | Duration | Format |
|--------|-------|----------|--------|
| AP-01 | How AI Assists Approvals | 15 min | Presentation |
| AP-02 | Reviewing Agent-Recommended Decisions | 25 min | Hands-on |
| AP-03 | Override and Escalation Procedures | 20 min | Workshop |
| AP-04 | Audit Trail Review | 20 min | Hands-on |
| AP-05 | Policy Feedback Loop | 10 min | Discussion |

**Learning Objectives:**
- Review and confirm/reject agent-recommended approvals
- Understand the audit trail for each approval decision
- Provide feedback to improve agent decision accuracy

### 2.3 Administrators

**Who:** ServiceNow admins and platform owners.  
**Duration:** 4 hours  
**Delivery:** Intensive workshop + documentation  

| Module | Topic | Duration | Format |
|--------|-------|----------|--------|
| AD-01 | Agent Architecture Overview | 30 min | Presentation |
| AD-02 | Agent Deployment & Configuration | 60 min | Hands-on |
| AD-03 | Monitoring & Observability | 45 min | Hands-on |
| AD-04 | Agent Performance Tuning | 45 min | Workshop |
| AD-05 | Incident Response for Agent Failures | 30 min | Hands-on |
| AD-06 | Adding New Workflows to Agent Fleet | 30 min | Workshop |

**Learning Objectives:**
- Deploy and configure AI agents for new workflows
- Monitor agent performance and health
- Diagnose and resolve agent failures
- Extend agent coverage to additional catalog items

## 3. How to Interact with Agents

### Natural Language Requests

Users interact with the orchestrator agent via chat:
- "I need a new laptop"
- "Request VPN access for the marketing team"
- "What's the status of my Salesforce license request?"

### Agent Response Patterns

| Agent Says | What It Means | User Action |
|-----------|---------------|-------------|
| "I've submitted your request — REF12345" | Request created | Wait for updates |
| "This request needs approval from your manager" | Approval triggered | Inform manager if urgent |
| "I need more information: which cost center?" | Missing info | Provide details |
| "I've escalated this to the IT support team" | Human handoff | Wait for human response |

## 4. Escalation Paths

```
User Request
    │
    ▼
Orchestrator Agent
    │
    ├── Auto-fulfilled ───────────────► Done (notify user)
    │
    ├── Needs Approval ──► Approval Agent ──► Auto-approved → Provisioning Agent
    │                          │
    │                          └──► Escalated to Human Approver
    │
    ├── Complex/Unknown ──► Escalation Agent ──► Human Support Team
    │
    └── Error/Failure ──► Notification Agent ──► User + Admin alerted
```

## 5. FAQ

**Q: Can I still use the ServiceNow portal?**  
A: Yes. The portal remains available during and after migration. The agent chat is an additional interface.

**Q: What if the agent makes a wrong decision?**  
A: All high-impact decisions require human approval. Agents log their rationale; admins can review and correct.

**Q: Is my data safe with AI agents?**  
A: Agents operate within your existing security boundaries. No data leaves approved environments.

**Q: How do I report an agent issue?**  
A: Use the standard IT support channel. Agent errors are automatically logged and alerted.

**Q: Will agents replace my job?**  
A: No. Agents automate repetitive tasks, freeing you to focus on high-value work.

## 6. Hands-On Exercises

### Exercise 1: Submit a Simple Request
1. Open the agent chat interface.
2. Type: "I need a new monitor for my desk."
3. Observe the orchestrator's response and follow prompts.

### Exercise 2: Handle an Approval
1. Log in as an approver.
2. Review a pending agent-recommended approval.
3. Confirm or reject the recommendation.
4. Check the audit trail for your decision.

### Exercise 3: Admin — Deploy a New Agent
1. Access the agent configuration dashboard.
2. Select a workflow from the catalog.
3. Configure agent roles and tools.
4. Run a test request through the agent.

## 7. Training Timeline

| Week | Audience | Module | Notes |
|------|----------|--------|-------|
| 1 | Admins | AD-01, AD-02 | Before Foundation Phase begins |
| 2 | Approvers | AP-01–AP-03 | Before Quick Wins Phase |
| 3 | End Users | EU-01–EU-03 | Pilot group only |
| 4 | Admins | AD-03, AD-04 | During Quick Wins |
| 5 | End Users | EU-01–EU-05 | Full rollout |
| 6-8 | All | Refresher + Q&A | Ongoing support |

## 8. Success Measurement

- **Completion Rate:** ≥ 95% of targeted users complete training
- **Knowledge Check:** Average score ≥ 80% on post-training quiz
- **Satisfaction:** Training NPS ≥ 50
- **Operational:** ≤ 5% of agent interactions result in unnecessary human escalation due to user error