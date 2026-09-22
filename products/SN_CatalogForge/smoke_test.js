// CatalogForge — Node.js mock-runtime smoke test
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Loads CatalogForgeEngine in a Node mock runtime and exercises the full
// deterministic pipeline (intake → infer → seed → wire → policy → flow).

'use strict';

// ---- minimal ServiceNow mocks ----
global.Class = {
    create: function () {
        return function () {
            if (this.initialize) { this.initialize.apply(this, arguments); }
        };
    }
};

// ---- indirect eval so `var` declarations leak to global scope ----
var fs = require('fs');
var path = require('path');
var engineSrc = fs.readFileSync(path.join(__dirname, 'scripts', 'CatalogForgeEngine.js'), 'utf8');
var e = eval;
e(engineSrc);

var engine = new CatalogForgeEngine();

var failures = 0;
function assert(cond, label) {
    if (cond) { console.log('PASS  ' + label); }
    else { console.log('FAIL  ' + label); failures++; }
}

// 1. Plain-language intake
var graph = engine.propose('New employee laptop, need requested for, department, hardware tier, justification');
assert(graph.ok === true, 'propose() returns ok for plain-language intake');
assert(graph.variable_count >= 4, 'inferred >= 4 variables (got ' + graph.variable_count + ')');

// 2. requested_for is always present and typed as reference→sys_user
var names = graph.variables.map(function (v) { return v.name; });
assert(names.indexOf('requested_for') !== -1, 'requested_for present');
var rf = null;
for (var i = 0; i < graph.variables.length; i++) { if (graph.variables[i].name === 'requested_for') { rf = graph.variables[i]; } }
assert(rf.type === 'reference' && rf.reference_table === 'sys_user', 'requested_for typed reference→sys_user');
assert(rf.mandatory === true, 'requested_for is mandatory');

// 3. hardware tier inferred as choice with seeded choices
var ht = null;
for (var j = 0; j < graph.variables.length; j++) { if (graph.variables[j].name === 'hardware_tier') { ht = graph.variables[j]; } }
assert(ht !== null, 'hardware_tier inferred');
assert(ht.type === 'choice', 'hardware_tier typed choice');
assert(ht.choices.length === 3, 'hardware_tier seeded with 3 choices (got ' + ht.choices.length + ')');

// 4. department inferred as reference → cmn_department
var dep = null;
for (var k = 0; k < graph.variables.length; k++) { if (graph.variables[k].name === 'department') { dep = graph.variables[k]; } }
assert(dep !== null, 'department inferred');
assert(dep.type === 'reference' && dep.reference_table === 'cmn_department', 'department typed reference→cmn_department');

// 5. variable-set wiring (Employee Information should collapse)
assert(graph.variable_sets.length >= 1, 'variable sets wired (got ' + graph.variable_sets.length + ')');

// 6. policies generated — use an intake that includes the trigger fields
//    (serial_number + hardware choice, and impact + justification).
var policyIntake = JSON.stringify({
    name: 'Laptop with Justification',
    variables: [
        { name: 'requested_for', type: 'reference', reference_table: 'sys_user' },
        { name: 'hardware', type: 'choice' },
        { name: 'serial_number', type: 'string' },
        { name: 'impact', type: 'choice' },
        { name: 'justification', type: 'string' }
    ]
});
var gPol = engine.propose(policyIntake);
assert(Array.isArray(gPol.policies), 'policies is an array');
assert(gPol.policies.length >= 2, 'policies generated when triggers present (got ' + gPol.policies.length + ')');
var hasSerialPolicy = gPol.policies.some(function (p) { return p.target === 'serial_number'; });
assert(hasSerialPolicy, 'serial_number visibility policy generated');
var hasJustificationPolicy = gPol.policies.some(function (p) { return p.target === 'justification' && p.type === 'mandatory'; });
assert(hasJustificationPolicy, 'justification mandatory policy generated');

// 7. flow configured
assert(graph.flow && graph.flow.kind === 'catalog_item', 'flow kind = catalog_item for standard item');
assert(graph.flow.variables.length === graph.variables.length, 'flow variables match variable list');

// 8. fingerprint is stable
var graph2 = engine.propose('New employee laptop, need requested for, department, hardware tier, justification');
assert(graph.fingerprint === graph2.fingerprint, 'fingerprint is deterministic');

// 9. Structured JSON intake with explicit variables + type override
var jsonIntake = JSON.stringify({
    name: 'New Hire Laptop',
    type: 'record_producer',
    target_table: 'incident',
    variables: [
        { name: 'requested_for', type: 'reference', reference_table: 'sys_user', mandatory: true },
        { name: 'hardware_tier', type: 'choice' },
        { name: 'custom_field', type: 'string', label: 'Custom Field' }
    ]
});
var g3 = engine.propose(jsonIntake);
assert(g3.ok === true, 'JSON intake parsed');
assert(g3.flow.kind === 'record_producer', 'JSON intake produced record_producer flow');
assert(g3.flow.target_table === 'incident', 'record_producer target_table = incident');
var hasCustom = g3.variables.some(function (v) { return v.name === 'custom_field' && v.label === 'Custom Field'; });
assert(hasCustom, 'explicit variable honored with custom label');

// 10. Empty intake rejected
var bad = engine.propose('');
assert(bad.ok === false && bad.error === 'EMPTY_INTAKE', 'empty intake rejected');

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURES'));
process.exit(failures === 0 ? 0 : 1);
