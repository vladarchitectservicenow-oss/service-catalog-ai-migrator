# SOP — SN Live Agent Broker (ID 10)
ServiceNow Live Agent Message Brokering Validator for Zurich

## Purpose
Validate and broker ServiceNow Live Agent chat messages for third-party integrations, ensuring message format compliance, session continuity, and queue routing integrity.

## Scope
- Zurich environments using ServiceNow Live Agent for external chat integrations
- Message brokering layer that sits between ServiceNow Live Agent and third-party endpoints
- Validation of inbound/outbound Live Agent payloads against the SN Live Agent protocol

## Responsibilities
| Role | Responsibility |
|------|---------------|
| Integration Engineer | Deploy and configure broker; review validation logs |
| QA Analyst | Run the test suite before every deployment |
| Platform Owner | Approve SOP changes and audit broker metrics |

## Procedure

### 1. Prerequisites
- Python 3.11+
- Read access to the broker repository
- No ServiceNow credentials required for testing (all tests use mocked REST responses)

### 2. Installation
```bash
cd products/SN_Live_Agent_Broker
python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
```
No external dependencies are required for core operation or tests.

### 3. Running the Validator
```bash
python -m src.broker_validator <mode> [options]
```
Modes:
- `validate-inbound` — check an incoming Live Agent message payload
- `validate-outbound` — check an outgoing Live Agent message payload
- `broker-session` — simulate a full brokered session end-to-end

### 4. Testing
```bash
python -m unittest tests.test_broker -v
```
All 10 tests must pass before deployment.

### 5. Validation Rules
The broker enforces the following rules on Live Agent messages:
1. `sessionId` must be a non-empty string (UUID or SN session token)
2. `messageType` must be one of: `text`, `file`, `system`, `typing`, `ended`
3. `payload` must be a dict and contain `body` for `text` messages
4. `timestamp` must be an ISO-8601 string when present
5. `agentId` and `visitorId` must be strings when present
6. Outbound messages must include `routingQueue` when `messageType` is `text`
7. `file` messages must include `payload.fileName` and `payload.fileSize`
8. `system` messages must set `payload.event` to a known event: `joined`, `left`, `transferred`
9. Session continuity: repeated `sessionId` values within a 30-minute window must share the same `visitorId`
10. `ended` messages must not carry a `payload.body`

### 6. Error Handling
Validation failures raise `BrokerValidationError` with a descriptive message.
Session continuity violations raise `SessionContinuityError`.

### 7. License
AGPL-3.0 — Copyright (c) Vladimir Kapustin

## References
- ServiceNow Live Agent REST API documentation
- Zurich integration standards v2.4
