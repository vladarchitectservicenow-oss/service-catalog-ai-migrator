#!/usr/bin/env node
// SpokePulse — IntegrationHub Spoke & Connection Health Monitor
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Self-contained unit tests using the Node.js mock runtime.
var fs = require('fs');
var path = require('path');
var assert = require('assert');

var BASE = path.join(__dirname, '..', 'scripts');

// ---- Mocks ----
global.Class = {
    create: function () {
        var Ctor = function () {
            if (this.initialize) this.initialize.apply(this, arguments);
        };
        return Ctor;
    }
};

global.GlideDateTime = function (v) {
    this._v = v || '2026-09-05 00:00:00';
};
GlideDateTime.prototype.getValue = function () { return this._v; };
GlideDateTime.prototype.setValue = function (v) { this._v = v; };
GlideDateTime.prototype.getNumericValue = function () {
    return Date.parse(this._v.replace(' ', 'T') + 'Z') || 0;
};

global.gs = {
    info: function () {},
    error: function () {},
    getProperty: function (k) {
        if (k === 'instance_name') return 'dev362840';
        if (k === 'glide.servlet.uri') return 'https://dev362840.service-now.com';
        return '';
    }
};

global.GlideTableDescriptor = {
    isValid: function (t) { return true; }
};

global.GlideEmailOutbound = function () {};
GlideEmailOutbound.prototype.setTo = function () {};
GlideEmailOutbound.prototype.setSubject = function () {};
GlideEmailOutbound.prototype.setBody = function () {};
GlideEmailOutbound.prototype.send = function () {};

// GlideRecord mock
global.GlideRecord = function (table) {
    this._tableName = table;
    this._values = {};
    this._filtered = [];
    this._index = -1;
    this._query = {};
    this._limit = 0;
    this._orderBy = '';
};
GlideRecord._store = {};
GlideRecord._tableRegistry = [];

GlideRecord.prototype.initialize = function () { this._values = {}; };
GlideRecord.prototype.setValue = function (f, v) { this._values[f] = v; };
GlideRecord.prototype.getValue = function (f) {
    if (f === 'sys_id') return this._values.sys_id || '';
    return this._values[f] !== undefined ? this._values[f] : '';
};
GlideRecord.prototype.getUniqueValue = function () { return this._values.sys_id || ''; };
GlideRecord.prototype.setLimit = function (n) { this._limit = n; };
GlideRecord.prototype.orderByDesc = function (f) { this._orderBy = f; };
GlideRecord.prototype.addQuery = function (f, op, v) {
    if (v === undefined) { v = op; op = '='; }
    this._query[f] = { op: op, value: String(v) };
};
GlideRecord.prototype.query = function () {
    var store = GlideRecord._store[this._tableName] || [];
    var self = this;
    this._filtered = store.filter(function (rec) {
        for (var f in self._query) {
            var q = self._query[f];
            var rv = String(rec[f] !== undefined ? rec[f] : '');
            if (q.op === '=' && rv !== q.value) return false;
        }
        return true;
    });
    if (this._orderBy) {
        var f = this._orderBy;
        this._filtered.sort(function (a, b) { return String(b[f]) < String(a[f]) ? -1 : 1; });
    }
    if (this._limit) this._filtered = this._filtered.slice(0, this._limit);
    this._index = -1;
};
GlideRecord.prototype.next = function () {
    this._index++;
    if (this._index < this._filtered.length) {
        this._values = this._filtered[this._index];
        return true;
    }
    return false;
};
GlideRecord.prototype.get = function (tableOrId) {
    if (!tableOrId) return false;
    var store = GlideRecord._store[this._tableName];
    if (store) {
        for (var i = 0; i < store.length; i++) {
            if (store[i].sys_id === tableOrId) {
                this._values = store[i];
                this._filtered = [store[i]];
                this._index = 0;
                return true;
            }
        }
    }
    if (this._tableName) return false;
    this._tableName = tableOrId;
    this._filtered = (GlideRecord._store[this._tableName] || []).slice();
    this._index = -1;
    return true;
};
GlideRecord.prototype.insert = function () {
    var sysId = 'sys_' + Math.random().toString(36).substring(2, 15);
    this._values.sys_id = sysId;
    if (!this._values.sys_created_on) this._values.sys_created_on = new GlideDateTime().getValue();
    if (!GlideRecord._store[this._tableName]) GlideRecord._store[this._tableName] = [];
    GlideRecord._store[this._tableName].push(this._values);
    return sysId;
};
GlideRecord.prototype.update = function () {
    var store = GlideRecord._store[this._tableName] || [];
    for (var i = 0; i < store.length; i++) {
        if (store[i].sys_id === this._values.sys_id) { store[i] = this._values; return; }
    }
};

// ---- Load source files (indirect eval) ----
function loadModule(filename) {
    var code = fs.readFileSync(path.join(BASE, filename), 'utf-8');
    var e = eval;
    e(code);
}
loadModule('SpokePulseScanner.js');
loadModule('SpokePulseEngine.js');

// ---- Test helpers ----
var passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('  \u2713 ' + name); }
    catch (e) { failed++; console.log('  \u2717 ' + name + '\n    ' + e.message); }
}

// ---- Seed mock data ----
function seed() {
    GlideRecord._store = {};
    GlideRecord._tableRegistry = ['x_snc_spk_health', 'x_snc_spk_scan_run', 'sys_credentials',
        'oauth_credential', 'basic_auth_credential', 'api_key_credential', 'sys_connection_alias',
        'sys_connection', 'sys_hub_spoke', 'sys_hub_flow_action', 'sys_hub_step'];

    // Expired credential
    GlideRecord._store['oauth_credential'] = [
        { sys_id: 'cred1', name: 'Expired OAuth', expires_on: '2026-08-01 00:00:00' },
        { sys_id: 'cred2', name: 'Expiring Soon', expires_on: '2026-09-10 00:00:00' },
        { sys_id: 'cred3', name: 'Healthy', expires_on: '2027-01-01 00:00:00' }
    ];

    // Drifted alias (references prod, instance is dev)
    GlideRecord._store['sys_connection_alias'] = [
        { sys_id: 'alias1', name: 'prod-salesforce-alias', connection: 'conn1' },
        { sys_id: 'alias2', name: 'dev-salesforce-alias', connection: 'conn2' }
    ];
    GlideRecord._store['sys_connection'] = [
        { sys_id: 'conn1', name: 'Salesforce Prod' },
        { sys_id: 'conn2', name: 'Salesforce Dev' }
    ];

    // Spoke version lag
    GlideRecord._store['sys_hub_spoke'] = [
        { sys_id: 'spoke1', name: 'Salesforce Spoke', version: '2.1.0', required_version: '2.3.0' },
        { sys_id: 'spoke2', name: 'Jira Spoke', version: '3.0.0', required_version: '3.0.0' }
    ];

    // Dead flow action
    GlideRecord._store['sys_hub_flow_action'] = [
        { sys_id: 'fa1', name: 'Create Case', step: 'step_dead' },
        { sys_id: 'fa2', name: 'Update Case', step: 'step_live' }
    ];
    GlideRecord._store['sys_hub_step'] = [
        { sys_id: 'step_live', name: 'Update Case Step' }
    ];
}

// ---- Tests ----
console.log('SpokePulse unit tests\n');

test('full scan produces scan-run record and findings', function () {
    seed();
    var scanner = new SpokePulseScanner();
    var runId = scanner.runScan('manual');
    assert.ok(runId, 'runId should be returned');
    assert.ok(GlideRecord._store['x_snc_spk_scan_run'].length >= 1, 'scan run record created');
    assert.ok(scanner._findings.length > 0, 'findings recorded');
});

test('expired credential flagged as broken (risk 100)', function () {
    seed();
    var scanner = new SpokePulseScanner();
    scanner.runScan('manual');
    var broken = scanner._findings.filter(function (f) {
        return f.item_type === 'credential' && f.item_name === 'Expired OAuth';
    });
    assert.equal(broken.length, 1);
    assert.equal(broken[0].risk_level, 'broken');
    assert.equal(broken[0].risk_score, 100);
});

test('expiring-soon credential flagged as at-risk', function () {
    seed();
    var scanner = new SpokePulseScanner();
    scanner.runScan('manual');
    var atRisk = scanner._findings.filter(function (f) {
        return f.item_type === 'credential' && f.item_name === 'Expiring Soon';
    });
    assert.equal(atRisk.length, 1);
    assert.equal(atRisk[0].risk_level, 'at-risk');
});

test('drifted alias (prod in dev) flagged as broken', function () {
    seed();
    var scanner = new SpokePulseScanner();
    scanner.runScan('manual');
    var drifted = scanner._findings.filter(function (f) {
        return f.item_type === 'connection' && f.item_name === 'prod-salesforce-alias';
    });
    assert.equal(drifted.length, 1);
    assert.equal(drifted[0].risk_level, 'broken');
});

test('spoke version lag flagged as at-risk', function () {
    seed();
    var scanner = new SpokePulseScanner();
    scanner.runScan('manual');
    var lag = scanner._findings.filter(function (f) {
        return f.item_type === 'spoke' && f.item_name === 'Salesforce Spoke';
    });
    assert.equal(lag.length, 1);
    assert.equal(lag[0].risk_level, 'at-risk');
});

test('dead flow action flagged as broken', function () {
    seed();
    var scanner = new SpokePulseScanner();
    scanner.runScan('manual');
    var dead = scanner._findings.filter(function (f) {
        return f.item_type === 'flow_action' && f.item_name === 'Create Case';
    });
    assert.equal(dead.length, 1);
    assert.equal(dead[0].risk_level, 'broken');
});

test('version comparison handles multi-segment versions', function () {
    var scanner = new SpokePulseScanner();
    assert.equal(scanner._compareVersions('2.1.0', '2.3.0'), -1);
    assert.equal(scanner._compareVersions('3.0.0', '3.0.0'), 0);
    assert.equal(scanner._compareVersions('2.10.0', '2.9.0'), 1);
});

test('engine getSummary returns distribution', function () {
    seed();
    var engine = new SpokePulseEngine();
    var summary = engine.runAndSummarize('manual');
    assert.ok(summary.distribution, 'distribution present');
    assert.ok(summary.total_items > 0, 'items present');
    assert.ok(summary.distribution.broken >= 1, 'broken items counted');
});

test('engine getAggregateRisk returns 0-100', function () {
    seed();
    var engine = new SpokePulseEngine();
    engine.runAndSummarize('manual');
    var risk = engine.getAggregateRisk();
    assert.ok(risk >= 0 && risk <= 100, 'risk in range');
});

test('engine generateRemediation returns narrative', function () {
    seed();
    var engine = new SpokePulseEngine();
    engine.runAndSummarize('manual');
    var health = GlideRecord._store['x_snc_spk_health'][0];
    var rem = engine.generateRemediation(health.sys_id);
    assert.ok(rem.narrative, 'narrative present');
    assert.ok(rem.source === 'deterministic' || rem.source === 'genai', 'source valid');
});

test('engine alertHighRisk returns no_recipient when unset', function () {
    seed();
    var engine = new SpokePulseEngine();
    engine.runAndSummarize('manual');
    var alert = engine.alertHighRisk();
    assert.equal(alert.alerted, false);
    assert.equal(alert.reason, 'no_recipient');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
