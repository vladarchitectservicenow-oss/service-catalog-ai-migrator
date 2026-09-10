// API Sentinel — ApiSentinelScanner
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Inventory + enforcement mapping + PII detection for the inbound API attack
// surface. All GlideRecord enumeration and ACL resolution lives here. This
// class is deterministic and read-only: it never writes to production data.
// @class ApiSentinelScanner @namespace x_snc_api_sentinel

var ApiSentinelScanner = Class.create();
ApiSentinelScanner.prototype = {
    initialize: function () {
        this._sensitiveTerms = [
            'ssn', 'social_security', 'social security', 'national_id', 'national id',
            'passport', 'salary', 'compensation', 'bank_account', 'bank account',
            'iban', 'swift', 'credit_card', 'credit card', 'card_number', 'card number',
            'cvv', 'dob', 'date_of_birth', 'birth_date', 'birthdate',
            'email', 'phone', 'mobile', 'address', 'home_address',
            'medical', 'health', 'diagnosis', 'patient', 'hipaa',
            'password', 'secret', 'token', 'api_key', 'api key', 'private_key'
        ];
    },

    /**
     * Run a full inventory scan. Returns an array of normalized endpoint
     * objects. Each object is a plain JS object (no GlideRecord references)
     * so it can be serialized to JSON and stored in the endpoint table.
     */
    scan: function () {
        var endpoints = [];
        endpoints = endpoints.concat(this._scanScriptedRest());
        endpoints = endpoints.concat(this._scanTableApi());
        endpoints = endpoints.concat(this._scanWebServices());
        endpoints = endpoints.concat(this._scanOAuthScopes());
        return endpoints;
    },

    /**
     * Enumerate Scripted REST API operations (sys_ws_operation) grouped by
     * their service definition (sys_ws_definition).
     */
    _scanScriptedRest: function () {
        var results = [];
        var op = new GlideRecord('sys_ws_operation');
        op.addActiveQuery();
        op.query();
        while (op.next()) {
            var defSysId = op.web_service_definition.getValue() || '';
            var script = op.script.toString() || '';
            var path = this._buildPath(defSysId, op.operation_uri.toString());
            results.push({
                endpoint_type: 'scripted_rest',
                name: op.name.toString(),
                path: path,
                auth_required: this._resolveAuth(op),
                role_guard: this._detectRoleGuard(script),
                tables_touched: this._extractTables(script),
                pii_fields: [],
                source_table: 'sys_ws_operation',
                source_sys_id: op.getUniqueValue()
            });
        }
        return results;
    },

    /**
     * Enumerate tables exposed via the Table API (sys_db_object with read
     * access enabled) and resolve their ACL enforcement.
     */
    _scanTableApi: function () {
        var results = [];
        var tbl = new GlideRecord('sys_db_object');
        tbl.addQuery('read_access', true);
        tbl.addQuery('name', 'STARTSWITH', 'x_').setOr(true);
        tbl.addQuery('name', 'STARTSWITH', 'sys_').setOr(true);
        tbl.addQuery('name', 'STARTSWITH', 'incident').setOr(true);
        tbl.addQuery('name', 'STARTSWITH', 'sc_').setOr(true);
        tbl.addQuery('name', 'STARTSWITH', 'sn_').setOr(true);
        tbl.query();
        while (tbl.next()) {
            var tableName = tbl.name.toString();
            var aclInfo = this._resolveTableAcls(tableName);
            results.push({
                endpoint_type: 'table_api',
                name: tbl.label.toString() || tableName,
                path: '/api/now/table/' + tableName,
                auth_required: aclInfo.requires_auth,
                role_guard: aclInfo.role_guard,
                tables_touched: [tableName],
                pii_fields: this._detectPiiFields(tableName),
                source_table: 'sys_db_object',
                source_sys_id: tbl.getUniqueValue()
            });
        }
        return results;
    },

    /**
     * Enumerate inbound SOAP/REST web services (sys_web_service).
     */
    _scanWebServices: function () {
        var results = [];
        var ws = new GlideRecord('sys_web_service');
        ws.addActiveQuery();
        ws.query();
        while (ws.next()) {
            results.push({
                endpoint_type: 'web_service',
                name: ws.name.toString(),
                path: ws.wsdl.toString() || '',
                auth_required: this._resolveWebServiceAuth(ws),
                role_guard: '',
                tables_touched: [],
                pii_fields: [],
                source_table: 'sys_web_service',
                source_sys_id: ws.getUniqueValue()
            });
        }
        return results;
    },

    /**
     * Enumerate OAuth clients and their granted scopes (oauth_entity +
     * oauth_entity_profile). Flags over-broad scope grants.
     */
    _scanOAuthScopes: function () {
        var results = [];
        var ent = new GlideRecord('oauth_entity');
        ent.addActiveQuery();
        ent.query();
        while (ent.next()) {
            var scopes = [];
            var prof = new GlideRecord('oauth_entity_profile');
            prof.addQuery('oauth_entity', ent.getUniqueValue());
            prof.query();
            while (prof.next()) {
                scopes.push(prof.scope.toString() || prof.name.toString());
            }
            results.push({
                endpoint_type: 'oauth_scope',
                name: ent.name.toString(),
                path: 'oauth:' + (ent.client_id.toString() || ent.getUniqueValue()),
                auth_required: 'authenticated',
                role_guard: scopes.join(','),
                tables_touched: [],
                pii_fields: [],
                source_table: 'oauth_entity',
                source_sys_id: ent.getUniqueValue()
            });
        }
        return results;
    },

    /**
     * Resolve whether a Scripted REST operation requires authentication.
     * Returns 'public' or 'authenticated'.
     */
    _resolveAuth: function (op) {
        var requiresAuth = op.requires_authentication.toString();
        if (requiresAuth === 'false' || requiresAuth === '0') {
            return 'public';
        }
        return 'authenticated';
    },

    /**
     * Resolve authentication for an inbound web service.
     */
    _resolveWebServiceAuth: function (ws) {
        var auth = ws.authentication_required.toString();
        if (auth === 'false' || auth === '0') {
            return 'public';
        }
        return 'authenticated';
    },

    /**
     * Detect whether a Scripted REST script contains a role guard
     * (gs.getUser().hasRole() / gs.hasRole()). Uses word-boundary matching to
     * avoid flagging unrelated identifiers (e.g. getUserCount).
     */
    _detectRoleGuard: function (script) {
        if (!script) {
            return '';
        }
        if (/\bhasRole\s*\(/.test(script) || /\bgetUser\s*\(/.test(script)) {
            return 'role_guard_present';
        }
        return '';
    },

    /**
     * Extract table names referenced in a script via GlideRecord('...').
     */
    _extractTables: function (script) {
        var tables = [];
        if (!script) {
            return tables;
        }
        var re = /GlideRecord\(\s*['"]([^'"]+)['"]\s*\)/g;
        var m;
        while ((m = re.exec(script)) !== null) {
            if (tables.indexOf(m[1]) === -1) {
                tables.push(m[1]);
            }
        }
        return tables;
    },

    /**
     * Resolve ACL enforcement for a table. Returns { requires_auth, role_guard }
     * where requires_auth is a normalized string ('public' | 'authenticated').
     * Roles are resolved via sys_security_acl_role (sys_security_acl has no
     * role field). A table with no read ACL is treated as public (exposed).
     */
    _resolveTableAcls: function (tableName) {
        var acl = new GlideRecord('sys_security_acl');
        acl.addQuery('name', tableName);
        acl.addQuery('operation', 'read');
        acl.query();
        var requiresAuth = false;
        var roleGuard = '';
        while (acl.next()) {
            var requiresRole = acl.requires_role.toString();
            if (requiresRole === 'true' || requiresRole === '1') {
                requiresAuth = true;
            }
            var aclRole = new GlideRecord('sys_security_acl_role');
            aclRole.addQuery('sys_security_acl', acl.getUniqueValue());
            aclRole.query();
            while (aclRole.next()) {
                var roleName = aclRole.sys_user_role.getDisplayValue() || '';
                if (roleName) {
                    roleGuard = roleGuard ? roleGuard + ',' + roleName : roleName;
                }
            }
        }
        return {
            requires_auth: requiresAuth ? 'authenticated' : 'public',
            role_guard: roleGuard
        };
    },

    /**
     * Detect PII/sensitive fields on a table by scanning sys_dictionary
     * element names and labels against the sensitive-terms dictionary.
     */
    _detectPiiFields: function (tableName) {
        var hits = [];
        var dict = new GlideRecord('sys_dictionary');
        dict.addQuery('name', tableName);
        dict.setLimit(500);
        dict.query();
        while (dict.next()) {
            var element = (dict.element.toString() || '').toLowerCase();
            var label = (dict.label.toString() || '').toLowerCase();
            for (var i = 0; i < this._sensitiveTerms.length; i++) {
                var term = this._sensitiveTerms[i];
                if (element.indexOf(term) > -1 || label.indexOf(term) > -1) {
                    if (hits.indexOf(dict.element.toString()) === -1) {
                        hits.push(dict.element.toString());
                    }
                    break;
                }
            }
        }
        return hits;
    },

    /**
     * Build a canonical Scripted REST path from a service definition sys_id and
     * operation URI: /api/<namespace>/<service_id>/<operation>. The namespace
     * comes from the definition's scope; the service id is the definition's
     * `id` field (not its sys_id).
     */
    _buildPath: function (defSysId, operationUri) {
        var serviceId = defSysId;
        var namespace = '';
        var def = new GlideRecord('sys_ws_definition');
        if (def.get(defSysId)) {
            serviceId = def.id.toString() || defSysId;
            var scopeGr = new GlideRecord('sys_scope');
            if (scopeGr.get(def.sys_scope.toString())) {
                namespace = scopeGr.scope.toString() || '';
            }
        }
        var base = '/api/' + (namespace ? namespace + '/' : '') + serviceId;
        var uri = operationUri || '';
        if (uri && uri.charAt(0) !== '/') {
            uri = '/' + uri;
        }
        return base + uri;
    },

    type: 'ApiSentinelScanner'
};
