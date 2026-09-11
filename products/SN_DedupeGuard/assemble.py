#!/usr/bin/env python3
# DedupeGuard — sys_app.xml assembler
# Copyright (C) 2026 Vladimir Kapustin
# SPDX-License-Identifier: AGPL-3.0
#
# Assembles the combined scoped-app manifest from the standalone .js sources,
# injecting each into a CDATA block so the manifest and the standalone files
# can never drift apart. Also emits the REST web-service definition/operations,
# seeded system properties, roles, and cross-scope privileges.
import os

BASE = os.path.dirname(os.path.abspath(__file__))

def read(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

engine = read(os.path.join(BASE, 'scripts', 'DedupeGuardEngine.js'))
merge = read(os.path.join(BASE, 'scripts', 'DedupeGuardMerge.js'))
get_candidates = read(os.path.join(BASE, 'rest', 'get_candidates.js'))
post_execute = read(os.path.join(BASE, 'rest', 'post_execute.js'))

SCOPE_ID = 'ddg00000000000000000000000000000000'
ADMIN_ROLE = 'ddg00000000000000000000000000000002'
USER_ROLE = 'ddg00000000000000000000000000000003'
WS_DEF_ID = 'ddg000000000000000000000000000000b0'

# Cross-scope privileges: read + write on target tables (merge engine writes),
# read on sys_dictionary (introspection), write on task (child re-pointing).
PRIV_TABLES = [
    ('sys_user', 'a0'),
    ('incident', 'a1'),
    ('cmdb_ci', 'a2'),
    ('sc_req_item', 'a3'),
    ('task', 'a5'),
]

def privilege_records():
    out = []
    for name, sid in PRIV_TABLES:
        for op in ('read', 'write'):
            out.append('''  <sys_scope_privilege action="INSERT_OR_UPDATE">
    <operation>%s</operation>
    <source_scope display_value="DedupeGuard">%s</source_scope>
    <status>allowed</status>
    <target_name>%s</target_name>
    <target_scope>global</target_scope>
    <target_type>table</target_type>
    <sys_class_name>sys_scope_privilege</sys_class_name>
    <sys_id>ddg000000000000000000000000000000%s%s</sys_id>
  </sys_scope_privilege>''' % (op, SCOPE_ID, name, sid, '0' if op == 'read' else '1'))
    # sys_dictionary — read only (introspection)
    out.append('''  <sys_scope_privilege action="INSERT_OR_UPDATE">
    <operation>read</operation>
    <source_scope display_value="DedupeGuard">%s</source_scope>
    <status>allowed</status>
    <target_name>sys_dictionary</target_name>
    <target_scope>global</target_scope>
    <target_type>table</target_type>
    <sys_class_name>sys_scope_privilege</sys_class_name>
    <sys_id>ddg000000000000000000000000000000a4</sys_id>
  </sys_scope_privilege>''' % SCOPE_ID)
    return '\n'.join(out)

# Seeded system properties (config moved to sys_properties).
PROPERTIES = [
    ('x_snc_ddg.scan.tables', 'sys_user,incident,cmdb_ci', 'string', 'Comma-separated list of tables to scan for duplicates.'),
    ('x_snc_ddg.scan.limit', '2000', 'integer', 'Maximum records collected per table scan.'),
    ('x_snc_ddg.threshold.auto_merge', '85', 'integer', 'Confidence (0-100) at or above which a pair is auto-queued for merge.'),
    ('x_snc_ddg.threshold.review', '50', 'integer', 'Confidence (0-100) at or above which a pair is surfaced for review.'),
    ('x_snc_ddg.weight.primary', '40', 'integer', 'Weight of the primary match field.'),
    ('x_snc_ddg.weight.secondary', '25', 'integer', 'Weight of the secondary match field.'),
    ('x_snc_ddg.weight.tertiary', '20', 'integer', 'Weight of the tertiary match field.'),
    ('x_snc_ddg.weight.quaternary', '15', 'integer', 'Weight of the quaternary match field.'),
    ('x_snc_ddg.weight.list', '40,25,20,15', 'string', 'Comma-separated weight list applied to match fields in order.'),
    ('x_snc_ddg.merge.protected_tables', 'sys_user,cmdb_ci,sys_user_group', 'string', 'Tables blocked from auto-merge.'),
    ('x_snc_ddg.merge.max_repoint', '5000', 'integer', 'Maximum child records re-pointed per reference field.'),
]

def property_records():
    out = []
    for i, (name, value, ptype, desc) in enumerate(PROPERTIES):
        out.append('''  <sys_property action="INSERT_OR_UPDATE">
    <description>%s</description>
    <name>%s</name>
    <type>%s</type>
    <value>%s</value>
    <sys_class_name>sys_property</sys_class_name>
    <sys_id>ddg000000000000000000000000000000c%02d</sys_id>
    <sys_scope display_value="DedupeGuard">%s</sys_scope>
  </sys_property>''' % (desc, name, ptype, value, i, SCOPE_ID))
    return '\n'.join(out)

manifest = '''<?xml version="1.0" encoding="UTF-8"?>
<unload unload_date="2026-09-11 07:00:00">
  <!-- ================================================================ -->
  <!-- DedupeGuard (x_snc_ddg) — combined scoped app manifest            -->
  <!-- Copyright (C) 2026 Vladimir Kapustin — SPDX-License-Identifier: AGPL-3.0 -->
  <!-- ================================================================ -->

  <!-- Scope -->
  <sys_scope action="INSERT_OR_UPDATE">
    <active>true</active>
    <description>Duplicate record detection and safe merge. Scans configurable tables, scores candidate duplicates with fuzzy matching, and merges them safely with full audit and rollback.</description>
    <name>DedupeGuard</name>
    <scope>x_snc_ddg</scope>
    <sys_class_name>sys_scope</sys_class_name>
    <sys_id>%s</sys_id>
    <sys_name>DedupeGuard</sys_name>
    <vendor>Vladimir Kapustin</vendor>
    <version>1.0.0</version>
  </sys_scope>

  <!-- Roles -->
  <sys_user_role action="INSERT_OR_UPDATE">
    <name>x_snc_ddg.admin</name>
    <description>DedupeGuard administrator — configure scans, execute merges, roll back.</description>
    <sys_class_name>sys_user_role</sys_class_name>
    <sys_id>%s</sys_id>
    <sys_scope display_value="DedupeGuard">%s</sys_scope>
  </sys_user_role>
  <sys_user_role action="INSERT_OR_UPDATE">
    <name>x_snc_ddg.user</name>
    <description>DedupeGuard user — read duplicate candidates and merge audit.</description>
    <sys_class_name>sys_user_role</sys_class_name>
    <sys_id>%s</sys_id>
    <sys_scope display_value="DedupeGuard">%s</sys_scope>
  </sys_user_role>

  <!-- Cross-scope privileges (read + write on target tables) -->
%s

  <!-- Seeded system properties -->
%s

  <!-- Script Include: DedupeGuardEngine -->
  <sys_script_include action="INSERT_OR_UPDATE">
    <access>package_private</access>
    <active>true</active>
    <api_name>x_snc_ddg.DedupeGuardEngine</api_name>
    <caller_access>false</caller_access>
    <client_callable>false</client_callable>
    <description>Fuzzy duplicate-detection and scoring engine.</description>
    <name>DedupeGuardEngine</name>
    <script><![CDATA[%s]]></script>
    <sys_class_name>sys_script_include</sys_class_name>
    <sys_id>ddg00000000000000000000000000000004</sys_id>
    <sys_scope display_value="DedupeGuard">%s</sys_scope>
  </sys_script_include>

  <!-- Script Include: DedupeGuardMerge -->
  <sys_script_include action="INSERT_OR_UPDATE">
    <access>package_private</access>
    <active>true</active>
    <api_name>x_snc_ddg.DedupeGuardMerge</api_name>
    <caller_access>false</caller_access>
    <client_callable>false</client_callable>
    <description>Safe merge engine with reference re-pointing, audit, and rollback.</description>
    <name>DedupeGuardMerge</name>
    <script><![CDATA[%s]]></script>
    <sys_class_name>sys_script_include</sys_class_name>
    <sys_id>ddg00000000000000000000000000000005</sys_id>
    <sys_scope display_value="DedupeGuard">%s</sys_scope>
  </sys_script_include>

  <!-- REST API: DedupeGuard API -->
  <sys_web_service_definition action="INSERT_OR_UPDATE">
    <active>true</active>
    <api_namespace>x_snc_ddg</api_namespace>
    <name>DedupeGuard API</name>
    <service_id>ddg</service_id>
    <sys_class_name>sys_web_service_definition</sys_class_name>
    <sys_id>%s</sys_id>
    <sys_scope display_value="DedupeGuard">%s</sys_scope>
  </sys_web_service_definition>

  <!-- REST operation: GET /candidates -->
  <sys_ws_operation action="INSERT_OR_UPDATE">
    <active>true</active>
    <name>GET /candidates</name>
    <operation_uri>/api/x_snc_ddg/ddg/candidates</operation_uri>
    <request_method>GET</request_method>
    <function_name>process</function_name>
    <script><![CDATA[%s]]></script>
    <sys_class_name>sys_ws_operation</sys_class_name>
    <sys_id>ddg000000000000000000000000000000b1</sys_id>
    <web_service_definition display_value="DedupeGuard API">%s</web_service_definition>
  </sys_ws_operation>

  <!-- REST operation: POST /execute -->
  <sys_ws_operation action="INSERT_OR_UPDATE">
    <active>true</active>
    <name>POST /execute</name>
    <operation_uri>/api/x_snc_ddg/ddg/execute</operation_uri>
    <request_method>POST</request_method>
    <function_name>process</function_name>
    <script><![CDATA[%s]]></script>
    <sys_class_name>sys_ws_operation</sys_class_name>
    <sys_id>ddg000000000000000000000000000000b2</sys_id>
    <web_service_definition display_value="DedupeGuard API">%s</web_service_definition>
  </sys_ws_operation>
</unload>
''' % (
    SCOPE_ID,
    ADMIN_ROLE, SCOPE_ID,
    USER_ROLE, SCOPE_ID,
    privilege_records(),
    property_records(),
    engine, SCOPE_ID,
    merge, SCOPE_ID,
    WS_DEF_ID, SCOPE_ID,
    get_candidates, WS_DEF_ID,
    post_execute, WS_DEF_ID,
)

out = os.path.join(BASE, 'sys_app.xml')
with open(out, 'w', encoding='utf-8') as f:
    f.write(manifest)

print('Wrote', out, len(manifest), 'bytes')
