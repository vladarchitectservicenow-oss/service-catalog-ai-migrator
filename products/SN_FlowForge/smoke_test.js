// FlowForge — engine smoke test (Node, ES5 mock runtime)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
'use strict';

// --- Minimal ServiceNow mocks ---
var GlideRecord = function () {};
GlideRecord.prototype.initialize = function () {};
GlideRecord.prototype.get = function () { return true; };
GlideRecord.prototype.getUniqueValue = function () { return 'test_sys_id'; };
GlideRecord.prototype.getValue = function (f) { return ''; };
GlideRecord.prototype.setValue = function (f, v) {};
GlideRecord.prototype.insert = function () { return 'inserted_sys_id'; };
GlideRecord.prototype.update = function () { return 'updated_sys_id'; };
GlideRecord.prototype.addQuery = function () { return this; };
GlideRecord.prototype.setLimit = function () { return this; };
GlideRecord.prototype.query = function () {};
GlideRecord.prototype.next = function () { return false; };
GlideRecord.prototype.hasNext = function () { return false; };
GlideRecord.prototype.setWorkflow = function () {};

var GlideDateTime = function () {};
GlideDateTime.prototype.getValue = function () { return '2026-09-23 05:10:00'; };

var gs = {
    getUserID: function () { return 'test_user'; },
    hasRole: function (r) { return r === 'x_snff.admin'; },
    addInfoMessage: function () {}
};

var Class = {
    create: function () { return function () {}; }
};
globalThis.Class = Class;
globalThis.GlideRecord = GlideRecord;
globalThis.GlideDateTime = GlideDateTime;
globalThis.gs = gs;

// Load the engine source and expose FlowForgeEngine.
var fs = require('fs');
var path = require('path');
var engineSrc = fs.readFileSync('/home/crixus/.pipeline/20260923_050035_3096/03_build/scripts/FlowForgeEngine.js', 'utf8');
var e = eval;
e(engineSrc);

var failures = 0;
function assert(cond, msg) {
    if (cond) { console.log('  PASS: ' + msg); }
    else { console.log('  FAIL: ' + msg); failures++; }
}

console.log('== FlowForgeEngine smoke test ==');

var engine = new FlowForgeEngine();

// 1. parseSpec accepts a valid spec
var spec = {
    name: 'P1 Incident Paging',
    description: 'Create a P1 incident and page the on-call lead',
    trigger: 'record created',
    table: 'incident',
    steps: [
        { action: 'create incident', inputs: { field_values: { short_description: 'P1', impact: '1' } } },
        { action: 'page on-call', inputs: { phone_number: '555', message: 'P1 incident' } }
    ]
};
var parsed = engine.parseSpec(JSON.stringify(spec));
assert(parsed.ok, 'parseSpec returns ok for valid spec');

// 2. resolveAction maps known token
var ra = engine.resolveAction('create incident');
assert(ra.ok && ra.resolved.action === 'Create Record', 'resolveAction maps "create incident" → Create Record');

// 3. resolveAction rejects unknown token
var ru = engine.resolveAction('frobnicate the thing');
assert(!ru.ok && ru.error === 'UNKNOWN_ACTION', 'resolveAction rejects unknown token');

// 4. generateFlow produces steps + validation clean
var gen = engine.generateFlow(parsed.spec);
assert(gen.ok, 'generateFlow returns ok (no structural errors)');
assert(gen.steps.length === 2, 'generateFlow resolves 2 steps');
assert(gen.validation.errors.length === 0, 'generateFlow has zero validation errors');

// 5. approvals append as a step
var spec2 = JSON.parse(JSON.stringify(spec));
spec2.approvals = [{ approver: 'manager', wait_for: 'any' }];
var p2 = engine.parseSpec(JSON.stringify(spec2));
var g2 = engine.generateFlow(p2.spec);
assert(g2.steps.length === 3, 'approvals appended as third step');

// 6. empty steps → validation error
var spec3 = { name: 'Empty Flow' };
var p3 = engine.parseSpec(JSON.stringify(spec3));
var g3 = engine.generateFlow(p3.spec);
assert(!g3.ok, 'flow with no steps fails validation');

// 7. missing required key
var p4 = engine.parseSpec('{}');
assert(!p4.ok && p4.error === 'MISSING_KEYS', 'missing name key rejected');

// 8. bad JSON
var p5 = engine.parseSpec('{not json');
assert(!p5.ok && p5.error === 'BAD_JSON', 'bad JSON rejected');

// 9. fingerprint deterministic
var f1 = engine.fingerprint(p2.spec);
var f2 = engine.fingerprint(p2.spec);
assert(f1 === f2 && f1.indexOf('ff_') === 0, 'fingerprint deterministic with ff_ prefix');

// 10. renderPreview produces readable output
var preview = engine.renderPreview(g2);
assert(preview.indexOf('Flow: P1 Incident Paging') === 0, 'renderPreview starts with flow name');

console.log('');
console.log(failures === 0 ? 'SMOKE TEST: ALL PASS' : 'SMOKE TEST: ' + failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
