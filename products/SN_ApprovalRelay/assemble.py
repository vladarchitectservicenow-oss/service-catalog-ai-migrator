#!/usr/bin/env python3
# Assemble ApprovalRelay sys_app.xml from individual artifact files.
# Guarantees CDATA byte-match between the manifest and standalone scripts.
import os, sys

BASE = "/home/crixus/.pipeline/20260907_050030_6857/03_build"
SCOPE = "x_sn_approval_relay"
APP = "ApprovalRelay"
DATE = "2026-09-07 00:00:00"

def read(p):
    with open(os.path.join(BASE, p), "r") as f:
        return f.read()

engine_js = read("scripts/ApprovalRelayEngine.js")
remediate_js = read("scripts/ApprovalRelayRemediate.js")
stalls_js = read("rest/stalls.js")
execute_js = read("rest/execute.js")

# Scheduled job script (extract from CDATA in br/scheduled_job.xml)
sched_xml = read("br/scheduled_job.xml")
sched_script = sched_xml.split("<![CDATA[")[1].split("]]>")[0]

def sys_id(prefix, n):
    return prefix + format(n, "x")

# sys_id allocation
ids = {}
def nid(key):
    return ids[key]

# We'll build incrementally with a counter
counter = [0]
def next_id(prefix):
    counter[0] += 1
    return prefix + format(counter[0], "x")

def scope_priv(op, target, target_scope, target_type, sid):
    return f'''  <sys_scope_privilege action="INSERT_OR_UPDATE">
    <operation>{op}</operation>
    <source_scope>{SCOPE}</source_scope>
    <status>allowed</status>
    <target_name>{target}</target_name>
    <target_scope>{target_scope}</target_scope>
    <target_type>{target_type}</target_type>
    <sys_class_name>sys_scope_privilege</sys_class_name>
    <sys_created_by>admin</sys_created_by>
    <sys_created_on>{DATE}</sys_created_on>
    <sys_id>{sid}</sys_id>
    <sys_mod_count>0</sys_mod_count>
    <sys_name>{target}</sys_name>
    <sys_package display_value="{APP}" source="{SCOPE}">{SCOPE}</sys_package>
    <sys_policy/>
    <sys_scope display_value="{APP}">{SCOPE}</sys_scope>
    <sys_update_name>sys_scope_privilege_{target}</sys_update_name>
    <sys_updated_by>admin</sys_updated_by>
    <sys_updated_on>{DATE}</sys_updated_on>
  </sys_scope_privilege>'''

def script_include(name, api, desc, script, sid):
    return f'''  <sys_script_include action="INSERT_OR_UPDATE">
    <access>package_private</access>
    <active>true</active>
    <api_name>{SCOPE}.{api}</api_name>
    <caller_access>true</caller_access>
    <client_callable>false</client_callable>
    <description>{desc}</description>
    <name>{name}</name>
    <script><![CDATA[
{script}
]]></script>
    <sys_class_name>sys_script_include</sys_class_name>
    <sys_created_by>admin</sys_created_by>
    <sys_created_on>{DATE}</sys_created_on>
    <sys_id>{sid}</sys_id>
    <sys_mod_count>0</sys_mod_count>
    <sys_name>{name}</sys_name>
    <sys_package display_value="{APP}" source="{SCOPE}">{SCOPE}</sys_package>
    <sys_policy/>
    <sys_scope display_value="{APP}">{SCOPE}</sys_scope>
    <sys_update_name>sys_script_include_{name.lower()}</sys_update_name>
    <sys_updated_by>admin</sys_updated_by>
    <sys_updated_on>{DATE}</sys_updated_on>
  </sys_script_include>'''

def ws_operation(name, method, script, sid, wsdef_sid):
    return f'''  <sys_ws_operation action="INSERT_OR_UPDATE">
    <active>true</active>
    <name>{name}</name>
    <operation_uri>{name}</operation_uri>
    <relative_path>{name}</relative_path>
    <request_method>{method}</request_method>
    <operation_script><![CDATA[
{script}
]]></operation_script>
    <sys_class_name>sys_ws_operation</sys_class_name>
    <sys_created_by>admin</sys_created_by>
    <sys_created_on>{DATE}</sys_created_on>
    <sys_id>{sid}</sys_id>
    <sys_mod_count>0</sys_mod_count>
    <sys_name>{name}</sys_name>
    <sys_package display_value="{APP}" source="{SCOPE}">{SCOPE}</sys_package>
    <sys_policy/>
    <sys_scope display_value="{APP}">{SCOPE}</sys_scope>
    <sys_update_name>sys_ws_operation_{name}</sys_update_name>
    <sys_updated_by>admin</sys_updated_by>
    <sys_updated_on>{DATE}</sys_updated_on>
    <sys_web_service_definition display_value="{APP} API">{wsdef_sid}</sys_web_service_definition>
  </sys_ws_operation>'''

def prop(name, desc, ptype, value, sid):
    return f'''  <sys_properties action="INSERT_OR_UPDATE">
    <description>{desc}</description>
    <name>{name}</name>
    <sys_class_name>sys_properties</sys_class_name>
    <sys_created_by>admin</sys_created_by>
    <sys_created_on>{DATE}</sys_created_on>
    <sys_id>{sid}</sys_id>
    <sys_mod_count>0</sys_mod_count>
    <sys_name>{name}</sys_name>
    <sys_package display_value="{APP}" source="{SCOPE}">{SCOPE}</sys_package>
    <sys_policy/>
    <sys_scope display_value="{APP}">{SCOPE}</sys_scope>
    <sys_update_name>sys_properties_{name.replace(".", "_")}</sys_update_name>
    <sys_updated_by>admin</sys_updated_by>
    <sys_updated_on>{DATE}</sys_updated_on>
    <type>{ptype}</type>
    <value>{value}</value>
  </sys_properties>'''

def role(name, desc, sid):
    return f'''  <sys_user_role action="INSERT_OR_UPDATE">
    <description>{desc}</description>
    <elevated_privilege>false</elevated_privilege>
    <name>{name}</name>
    <sys_class_name>sys_user_role</sys_class_name>
    <sys_created_by>admin</sys_created_by>
    <sys_created_on>{DATE}</sys_created_on>
    <sys_id>{sid}</sys_id>
    <sys_mod_count>0</sys_mod_count>
    <sys_name>{name}</sys_name>
    <sys_package display_value="{APP}" source="{SCOPE}">{SCOPE}</sys_package>
    <sys_policy/>
    <sys_scope display_value="{APP}">{SCOPE}</sys_scope>
    <sys_update_name>sys_user_role_{name}</sys_update_name>
    <sys_updated_by>admin</sys_updated_by>
    <sys_updated_on>{DATE}</sys_updated_on>
  </sys_user_role>'''

def event(name, desc, sid):
    return f'''  <sysevent_register action="INSERT_OR_UPDATE">
    <description>{desc}</description>
    <event_name>{name}</event_name>
    <sys_class_name>sysevent_register</sys_class_name>
    <sys_created_by>admin</sys_created_by>
    <sys_created_on>{DATE}</sys_created_on>
    <sys_id>{sid}</sys_id>
    <sys_mod_count>0</sys_mod_count>
    <sys_name>{name}</sys_name>
    <sys_package display_value="{APP}" source="{SCOPE}">{SCOPE}</sys_package>
    <sys_policy/>
    <sys_scope display_value="{APP}">{SCOPE}</sys_scope>
    <sys_update_name>sysevent_register_{name.replace(".", "_")}</sys_update_name>
    <sys_updated_by>admin</sys_updated_by>
    <sys_updated_on>{DATE}</sys_updated_on>
  </sysevent_register>'''

parts = []

# 1. sys_scope
parts.append(f'''  <sys_scope action="INSERT_OR_UPDATE">
    <app_scope>{SCOPE}</app_scope>
    <description>ApprovalRelay — Stalled &amp; Orphaned Approval Detector with Auto-Remediation. Scans sysapproval_approver for silently stalled approvals, classifies the root cause into five buckets, and auto-remediates or escalates before an SLA breaches.</description>
    <name>{APP}</name>
    <private>true</private>
    <runtime_access_tracking>false</runtime_access_tracking>
    <scope>{SCOPE}</scope>
    <sys_class_name>sys_scope</sys_class_name>
    <sys_created_by>admin</sys_created_by>
    <sys_created_on>{DATE}</sys_created_on>
    <sys_id>{next_id("f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c")}</sys_id>
    <sys_mod_count>0</sys_mod_count>
    <sys_name>{APP}</sys_name>
    <sys_package display_value="{APP}" source="{SCOPE}">{SCOPE}</sys_package>
    <sys_policy/>
    <sys_scope display_value="{APP}">{SCOPE}</sys_scope>
    <sys_update_name>sys_scope_{SCOPE}</sys_update_name>
    <sys_updated_by>admin</sys_updated_by>
    <sys_updated_on>{DATE}</sys_updated_on>
  </sys_scope>''')

# 2. roles
parts.append(role("x_sn_approval_relay.admin", "ApprovalRelay administrator — full access to configuration, remediation, and alerting.", next_id("f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c")))
parts.append(role("x_sn_approval_relay.user", "ApprovalRelay user — read-only access to stall and alert records.", next_id("f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c")))

# 3. cross-scope privileges (7 read + 2 write)
read_tables = ["sysapproval_approver", "sysapproval_group", "sys_user", "sys_user_group", "sys_user_grmember", "sys_user_delegate", "task"]
for t in read_tables:
    parts.append(scope_priv("read", t, "global", "table", next_id("f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c")))
parts.append(scope_priv("write", "incident", "global", "table", next_id("f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c")))
parts.append(scope_priv("write", "sysapproval_approver", "global", "table", next_id("f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c")))

# 4. script includes
parts.append(script_include("ApprovalRelayEngine", "ApprovalRelayEngine", "Deterministic stalled-approval scanner and five-bucket root-cause classifier.", engine_js, next_id("f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c")))
parts.append(script_include("ApprovalRelayRemediate", "ApprovalRelayRemediate", "Per-bucket remediation, alerting, and audit logging.", remediate_js, next_id("f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c")))

# 5. REST web service definition + operations
wsdef_sid = next_id("f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c")
parts.append(f'''  <sys_ws_definition action="INSERT_OR_UPDATE">
    <active>true</active>
    <base_uri>api/{SCOPE}</base_uri>
    <description>ApprovalRelay stall query and action API.</description>
    <name>{APP} API</name>
    <sys_class_name>sys_ws_definition</sys_class_name>
    <sys_created_by>admin</sys_created_by>
    <sys_created_on>{DATE}</sys_created_on>
    <sys_id>{wsdef_sid}</sys_id>
    <sys_mod_count>0</sys_mod_count>
    <sys_name>{APP} API</sys_name>
    <sys_package display_value="{APP}" source="{SCOPE}">{SCOPE}</sys_package>
    <sys_policy/>
    <sys_scope display_value="{APP}">{SCOPE}</sys_scope>
    <sys_update_name>sys_ws_definition_approval_relay_api</sys_update_name>
    <sys_updated_by>admin</sys_updated_by>
    <sys_updated_on>{DATE}</sys_updated_on>
  </sys_ws_definition>''')
parts.append(ws_operation("stalls", "GET", stalls_js, next_id("f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c"), wsdef_sid))
parts.append(ws_operation("execute", "POST", execute_js, next_id("f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c"), wsdef_sid))

# 6. scheduled job
parts.append(f'''  <sysauto_script action="INSERT_OR_UPDATE">
    <active>true</active>
    <condition/>
    <description>Scans for stalled approvals, classifies root cause, and raises alerts.</description>
    <name>ApprovalRelay Stall Scan</name>
    <run_dayofweek/>
    <run_dayofmonth/>
    <run_month/>
    <run_period>86400</run_period>
    <run_start>{DATE}</run_start>
    <run_time/>
    <run_type>periodically</run_type>
    <script><![CDATA[
{sched_script}
]]></script>
    <sys_class_name>sysauto_script</sys_class_name>
    <sys_created_by>admin</sys_created_by>
    <sys_created_on>{DATE}</sys_created_on>
    <sys_id>{next_id("f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c")}</sys_id>
    <sys_mod_count>0</sys_mod_count>
    <sys_name>ApprovalRelay Stall Scan</sys_name>
    <sys_package display_value="{APP}" source="{SCOPE}">{SCOPE}</sys_package>
    <sys_policy/>
    <sys_scope display_value="{APP}">{SCOPE}</sys_scope>
    <sys_update_name>sysauto_script_approval_relay_stall_scan</sys_update_name>
    <sys_updated_by>admin</sys_updated_by>
    <sys_updated_on>{DATE}</sys_updated_on>
  </sysauto_script>''')

# 7. events
parts.append(event("x_sn_approval_relay.alert", "ApprovalRelay alert event — raised when a stalled approval is classified.", next_id("f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c")))
parts.append(event("x_sn_approval_relay.escalation", "ApprovalRelay escalation event — raised when a stall is escalated to the request assignee.", next_id("f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c")))
parts.append(event("x_sn_approval_relay.delegation_prompt", "ApprovalRelay delegation prompt event — raised to prompt an approver's manager to configure delegation.", next_id("f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c")))

# 8. system properties
props = [
    ("x_sn_approval_relay.stall_hours", "ApprovalRelay — stalled-approval age threshold (hours).", "integer", "48"),
    ("x_sn_approval_relay.away_login_hours", "ApprovalRelay — away threshold: last login older than this (hours).", "integer", "72"),
    ("x_sn_approval_relay.orphaned_enabled", "ApprovalRelay — enable orphaned-approver detection.", "boolean", "true"),
    ("x_sn_approval_relay.no_delegation_enabled", "ApprovalRelay — enable no-delegation detection.", "boolean", "true"),
    ("x_sn_approval_relay.dead_group_enabled", "ApprovalRelay — enable dead-group detection.", "boolean", "true"),
    ("x_sn_approval_relay.dead_end_enabled", "ApprovalRelay — enable dead-end-chain detection.", "boolean", "true"),
    ("x_sn_approval_relay.silent_enabled", "ApprovalRelay — enable silent-approver detection.", "boolean", "true"),
    ("x_sn_approval_relay.reassign_enabled", "ApprovalRelay — enable auto-reassign to manager (destructive, off by default).", "boolean", "false"),
    ("x_sn_approval_relay.escalate_enabled", "ApprovalRelay — enable auto-escalate to assignee (destructive, off by default).", "boolean", "false"),
    ("x_sn_approval_relay.prompt_enabled", "ApprovalRelay — enable one-click delegation prompt.", "boolean", "true"),
    ("x_sn_approval_relay.create_incident", "ApprovalRelay — auto-create incident on critical stall.", "boolean", "true"),
    ("x_sn_approval_relay.notify_users", "ApprovalRelay — comma-separated notification recipients (empty = disabled).", "string", ""),
    ("x_sn_approval_relay.alert_cooldown_minutes", "ApprovalRelay — alert dedup cooldown (minutes).", "integer", "60"),
]
for name, desc, ptype, value in props:
    parts.append(prop(name, desc, ptype, value, next_id("f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c")))

body = "\n".join(parts)
xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<unload unload_date="{DATE}">
{body}
</unload>
'''

out = os.path.join(BASE, "sys_app.xml")
with open(out, "w") as f:
    f.write(xml)

print("Wrote", out, "lines:", xml.count("\n") + 1, "bytes:", len(xml))
