# Technical Architecture — Sandbox Migration Shield

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     SERVICE NOW INSTANCE                             │
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │  Service Portal   │  │   Workspace UI   │  │   REST API Layer  │  │
│  │  (Widgets)        │  │   (UXF Client)   │  │   (Scripted REST) │  │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬──────────┘  │
│           │                     │                      │             │
│           └─────────────────────┼──────────────────────┘             │
│                                 │                                    │
│  ┌──────────────────────────────┴──────────────────────────────┐    │
│  │                   SCRIPT INCLUDES LAYER                      │    │
│  │                                                              │    │
│  │  ┌────────────────┐ ┌────────────────┐ ┌─────────────────┐   │    │
│  │  │ SandboxScanner │ │MigrationEngine │ │ExemptionManager │   │    │
│  │  └───────┬────────┘ └───────┬────────┘ └────────┬────────┘   │    │
│  │          └──────────────────┼───────────────────┘             │    │
│  └──────────────────────────────┼──────────────────────────────┘    │
│                                 │                                    │
│  ┌──────────────────────────────┴──────────────────────────────┐    │
│  │                     DATA LAYER                               │    │
│  │                                                              │    │
│  │  Custom Tables:                                              │    │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────┐  │    │
│  │  │x_snc_sms_scan_   │ │x_snc_sms_        │ │x_snc_sms_    │  │    │
│  │  │result            │ │exemption         │ │audit_log     │  │    │
│  │  └──────────────────┘ └──────────────────┘ └──────────────┘  │    │
│  │                                                              │    │
│  │  Platform Tables (READ):                                     │    │
│  │  sys_script, sys_script_include, sys_script_client,          │    │
│  │  sys_ui_policy, sys_ui_action, sys_dictionary                │    │
│  └──────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Breakdown

### 1. SandboxScanner (Script Include: `SandboxScanner`)
**Purpose:** Core scanning engine that traverses all script tables and identifies incompatible patterns.

**Input:**
- `scope`: optional application scope filter
- `table`: optional specific table filter
- `full_scan`: boolean — full scan or incremental

**Output:**
- Array of `ScanResult` objects written to `x_snc_sms_scan_result`
- Summary stats: total scripts, blocking count, warning count, compatible count

**KB2944435 Incompatibility Patterns Detected:**
1. Use of restricted sandbox APIs (e.g., `Packages.java`, `java.lang.*`)
2. Direct `eval()` calls
3. Unsafe `GlideRecord` patterns
4. Deprecated `gs.*` methods scheduled for removal
5. Cross-scope access violations

### 2. MigrationEngine (Script Include: `MigrationEngine`)
**Purpose:** Extracts inline JavaScript logic and creates secure Script Includes.

**Flow:**
1. Read source script from `sys_script` or `sys_script_client`
2. Parse to identify reusable logic blocks
3. Generate new `sys_script_include` with:
   - `name`: auto-generated from script name + function
   - `script`: extracted logic wrapped in a function
   - `api_name`: `x_snc_sms.FunctionName`
   - `access`: `public` or `package_private`
4. Generate replacement call for original script field
5. Execute in preview mode → user confirms → commit
6. Rollback: stored original values restored

### 3. ExemptionManager (Script Include: `ExemptionManager`)
**Purpose:** Manages the exemption lifecycle with audit trail.

**Key Functions:**
- `createExemption(scriptId, justification, approverId, expiryDate)`
- `approveExemption(exemptionId)`
- `revokeExemption(exemptionId)`
- `getExpiringExemptions(daysThreshold)` — for scheduled job
- `calculateReadinessScore()` — excludes exempted scripts

### 4. Scheduled Jobs
- **Weekly Auto-Scan** (`x_snc_sms_weekly_scan`): Runs every Sunday at 02:00, triggers `SandboxScanner` with `full_scan=true`
- **Exemption Expiry Check** (`x_snc_sms_exemption_check`): Runs daily at 08:00, notifies owners of exemptions expiring in 30 days

### 5. Scripted REST APIs

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/x_snc_sms/v1/scan` | POST | Trigger a new scan |
| `/api/x_snc_sms/v1/scan/{id}` | GET | Get scan results |
| `/api/x_snc_sms/v1/migrate` | POST | Execute migration |
| `/api/x_snc_sms/v1/exemption` | POST | Create exemption |
| `/api/x_snc_sms/v1/exemption/{id}` | GET/PATCH | Read/update exemption |
| `/api/x_snc_sms/v1/dashboard` | GET | Get dashboard summary data |
| `/api/x_snc_sms/v1/preview-migration` | POST | Preview migration without executing |

### 6. Service Portal Widgets
- **Dashboard Widget:** Readiness score gauge + severity breakdown
- **Scan Widget:** Trigger scan button + progress indicator
- **Script List Widget:** Filterable, sortable table of scanned scripts
- **Exemption Widget:** Exemption creation form + approval status

## Data Model

### Custom Tables

#### `x_snc_sms_scan_result`
| Field | Type | Description |
|-------|------|-------------|
| `sys_id` | GUID | Primary key |
| `script_table` | String | Source table (sys_script, sys_script_include, etc.) |
| `script_sys_id` | GUID | Reference to source script record |
| `script_name` | String | Display name of the script |
| `script_field` | String | Field containing the script (script, condition, etc.) |
| `severity` | Choice | BLOCKING, WARNING, COMPATIBLE |
| `issue_code` | String | KB2944435 issue code identifier |
| `issue_description` | String | Human-readable description of the issue |
| `source_code_snippet` | String (4000) | Excerpt of problematic code |
| `status` | Choice | NEW, MIGRATED, EXEMPT, IGNORED |
| `scan_run` | Reference → `x_snc_sms_scan_run` | Which scan found this |
| `detected_at` | DateTime | When detected |

#### `x_snc_sms_scan_run`
| Field | Type | Description |
|-------|------|-------------|
| `sys_id` | GUID | Primary key |
| `scan_type` | Choice | FULL, INCREMENTAL, MANUAL |
| `scope` | String | Application scope filter used |
| `started_at` | DateTime | Scan start time |
| `completed_at` | DateTime | Scan end time |
| `total_scripts` | Integer | Total scripts scanned |
| `blocking_count` | Integer | BLOCKING severity count |
| `warning_count` | Integer | WARNING severity count |
| `compatible_count` | Integer | COMPATIBLE count |

#### `x_snc_sms_exemption`
| Field | Type | Description |
|-------|------|-------------|
| `sys_id` | GUID | Primary key |
| `scan_result` | Reference → `x_snc_sms_scan_result` | Related finding |
| `business_justification` | String (4000) | Why this cannot be migrated |
| `approver` | Reference → `sys_user` | Who approved |
| `approved_at` | DateTime | Approval timestamp |
| `expires_at` | Date | Review-by date |
| `status` | Choice | PENDING, APPROVED, REJECTED, EXPIRED |

#### `x_snc_sms_audit_log`
| Field | Type | Description |
|-------|------|-------------|
| `sys_id` | GUID | Primary key |
| `action` | Choice | SCAN, MIGRATE, EXEMPTION_CREATE, EXEMPTION_APPROVE, ROLLBACK |
| `target_table` | String | Affected table |
| `target_sys_id` | GUID | Affected record |
| `details` | String (4000) | JSON-formatted change details |
| `user` | Reference → `sys_user` | Who performed action |
| `timestamp` | DateTime | When |

## Security Model

### ACLs

| Table | Operation | Role Required |
|-------|-----------|---------------|
| `x_snc_sms_scan_result` | Read | `x_snc_sms.admin`, `x_snc_sms.viewer` |
| `x_snc_sms_scan_result` | Write | `x_snc_sms.admin` (system only) |
| `x_snc_sms_scan_run` | Read | `x_snc_sms.admin`, `x_snc_sms.viewer` |
| `x_snc_sms_exemption` | Create, Read | `x_snc_sms.admin`, `x_snc_sms.architect` |
| `x_snc_sms_exemption` | Write (approve) | `x_snc_sms.architect` |
| `x_snc_sms_audit_log` | Read | `x_snc_sms.admin`, `x_snc_sms.architect` |
| `sys_script*` | Read | All authenticated (platform default) |
| `sys_script_include` | Create, Write | `x_snc_sms.admin` (migration) |

### Roles
- **`x_snc_sms.admin`**: Full access — scan, migrate, manage exemptions
- **`x_snc_sms.architect`**: Create/approve exemptions, view audit logs
- **`x_snc_sms.viewer`**: Read-only access to dashboards and results

### Application Scope
- **Scope name:** `x_snc_sms` (Sandbox Migration Shield)
- **Accessible from:** This application only
- **REST APIs:** Authenticated via Basic Auth or OAuth token with `x_snc_sms.admin` role

## Deployment Model

- **Form factor:** Scoped Application
- **Distribution:** ServiceNow Store + direct update set
- **Installation:** One-click from Store, or import update set
- **Post-install:** Configuration wizard to map roles to existing groups
- **Upgrades:** Update set overlay, preserves custom data

## Integration Points

| Integration | Direction | Protocol | Purpose |
|------------|-----------|----------|---------|
| Platform script tables | Read-only | GlideRecord | Scan source |
| sys_script_include | Write | GlideRecord | Create migrated scripts |
| Email (sys_email) | Outbound | GlideRecord | Notification delivery |
| sys_update_set | Read | GlideRecord | Upgrade Impact Predictor |
| sys_audit (platform) | Read | GlideRecord | Cross-reference platform changes |
