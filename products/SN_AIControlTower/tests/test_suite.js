// Copyright (c) 2026 Vladimir Kapustin. Licensed under AGPL-3.0.
// AIControlTower — Unit Test Suite
// Tests TowerCore, TowerAnalytics, TowerGovernance using Node.js mock runtime

var assert = require('assert');
var mock = require('./mock_runtime');
var fs = require('fs');
var path = require('path');

var SI_DIR = path.join(__dirname, '..', 'script_includes');
var tests_passed = 0;
var tests_failed = 0;
var test_results = [];

function test(name, fn) {
    try {
        fn();
        tests_passed++;
        test_results.push({ name: name, status: 'PASS' });
        console.log('  ✅ ' + name);
    } catch (e) {
        tests_failed++;
        test_results.push({ name: name, status: 'FAIL', error: e.message });
        console.log('  ❌ ' + name + ': ' + e.message);
    }
}

// ─── Helper: Load SI with mock globals ───
function loadSI(filename) {
    mock.resetTables();
    var code = fs.readFileSync(path.join(SI_DIR, filename), 'utf8');
    // Strip copyright comment line
    var sandbox = {
        GlideRecord: mock.GlideRecord,
        GlideDateTime: mock.GlideDateTime,
        gs: mock.gs,
        Class: mock.Class,
        JSON: JSON,
        Math: Math,
        Array: Array,
        Object: Object,
        console: console
    };
    var fn = new Function(Object.keys(sandbox).join(', '), code);
    fn.apply(null, Object.values(sandbox));
    // Class.create() puts constructors into local scope — we need to return them
    // In our mock, Class.create() returns a constructor function
    // But the SI code creates global vars (var TowerCore = Class.create()...)
    // We need to eval in a way that captures those vars
    return sandbox;
}

// Alternative: use eval to capture globals
function loadSIEval(filename) {
    mock.resetTables();
    var code = fs.readFileSync(path.join(SI_DIR, filename), 'utf8');
    var GlideRecord = mock.GlideRecord;
    var GlideDateTime = mock.GlideDateTime;
    var gs = mock.gs;
    var Class = mock.Class;
    var result = {};
    // Use eval in a scope where we can capture the vars
    eval(code);
    return { TowerCore: typeof TowerCore !== 'undefined' ? TowerCore : null,
             TowerAnalytics: typeof TowerAnalytics !== 'undefined' ? TowerAnalytics : null,
             TowerGovernance: typeof TowerGovernance !== 'undefined' ? TowerGovernance : null };
}

// ─── TowerCore Tests ───
console.log('\n═══ TowerCore Tests ═══');

// Test 1: ingest — valid payload
test('TowerCore.ingest — valid payload stores records', function() {
    var si = loadSIEval('TowerCore.js');
    assert.ok(si.TowerCore, 'TowerCore class not loaded');
    mock.seedTable('x_snc_ai_tower_config', [
        { sys_id: 'inst_001', config_type: 'instance', name: 'PROD-US', auth_token: 'valid_token_123', active: 'true' }
    ]);
    var core = new si.TowerCore();
    var payload = {
        instance_token: 'valid_token_123',
        sync_id: 'sync_001',
        records: [
            { record_type: 'usage', product: 'Now Assist', capability: 'Catalog Item Gen', source_id: 'rec_001', request_count: 5, success_count: 4, failure_count: 1 }
        ]
    };
    var result = core.ingest(payload);
    assert.strictEqual(result.accepted, 1, 'Expected 1 accepted, got ' + result.accepted);
    assert.strictEqual(result.rejected, 0, 'Expected 0 rejected');
    var records = mock.getTable('x_snc_ai_tower_record');
    assert.strictEqual(records.length, 1, 'Expected 1 record in table');
    assert.strictEqual(records[0].product, 'Now Assist');
});

// Test 2: ingest — invalid token rejected
test('TowerCore.ingest — invalid token rejects all records', function() {
    var si = loadSIEval('TowerCore.js');
    mock.seedTable('x_snc_ai_tower_config', [
        { sys_id: 'inst_001', config_type: 'instance', auth_token: 'valid_token_123', active: 'true' }
    ]);
    var core = new si.TowerCore();
    var payload = {
        instance_token: 'WRONG_TOKEN',
        sync_id: 'sync_002',
        records: [{ record_type: 'usage', product: 'Now Assist', source_id: 'rec_002' }]
    };
    var result = core.ingest(payload);
    assert.strictEqual(result.accepted, 0, 'Expected 0 accepted');
    assert.strictEqual(result.rejected, 1, 'Expected 1 rejected');
});

// Test 3: ingest — duplicate detection
test('TowerCore.ingest — duplicate source_id rejected', function() {
    var si = loadSIEval('TowerCore.js');
    mock.seedTable('x_snc_ai_tower_config', [
        { sys_id: 'inst_001', config_type: 'instance', auth_token: 'tok_123', active: 'true' }
    ]);
    mock.seedTable('x_snc_ai_tower_record', [
        { sys_id: 'existing_001', instance: 'inst_001', source_id: 'dup_001', product: 'Now Assist', record_type: 'usage' }
    ]);
    var core = new si.TowerCore();
    var payload = {
        instance_token: 'tok_123',
        sync_id: 'sync_003',
        records: [{ record_type: 'usage', product: 'Now Assist', source_id: 'dup_001', request_count: 1 }]
    };
    var result = core.ingest(payload);
    assert.strictEqual(result.accepted, 0, 'Duplicate should be rejected');
    assert.strictEqual(result.rejected, 1);
});

// Test 4: ingest — missing records array
test('TowerCore.ingest — missing records array returns error', function() {
    var si = loadSIEval('TowerCore.js');
    var core = new si.TowerCore();
    var result = core.ingest({ instance_token: 'tok_123' });
    assert.strictEqual(result.accepted, 0);
    assert.ok(result.errors.length > 0, 'Should have error message');
});

// Test 5: ingest — invalid record_type
test('TowerCore.ingest — invalid record_type rejected', function() {
    var si = loadSIEval('TowerCore.js');
    mock.seedTable('x_snc_ai_tower_config', [
        { sys_id: 'inst_001', config_type: 'instance', auth_token: 'tok_123', active: 'true' }
    ]);
    var core = new si.TowerCore();
    var payload = {
        instance_token: 'tok_123',
        sync_id: 'sync_004',
        records: [{ record_type: 'INVALID', product: 'Now Assist', source_id: 'rec_003' }]
    };
    var result = core.ingest(payload);
    assert.strictEqual(result.rejected, 1, 'Invalid record_type should be rejected');
});

// Test 6: registerConnector
test('TowerCore.registerConnector — stores connector config', function() {
    var si = loadSIEval('TowerCore.js');
    var core = new si.TowerCore();
    var id = core.registerConnector({
        product_name: 'Now Assist',
        source_tables: 'sn_now_assist_interaction,sn_now_assist_usage',
        field_mappings: { 'interaction_id': 'sys_id', 'user': 'user' },
        version: '1.0'
    });
    assert.ok(id, 'Should return sys_id');
    var configs = mock.getTable('x_snc_ai_tower_config');
    assert.strictEqual(configs.length, 1);
    assert.strictEqual(configs[0].config_type, 'connector');
});

// Test 7: getConnector
test('TowerCore.getConnector — returns connector by product name', function() {
    var si = loadSIEval('TowerCore.js');
    mock.seedTable('x_snc_ai_tower_config', [
        { sys_id: 'conn_001', config_type: 'connector', product_name: 'Now Assist', source_tables: 'sn_now_assist_interaction', field_mappings: '{}', version: '1.0', active: 'true' }
    ]);
    var core = new si.TowerCore();
    var conn = core.getConnector('Now Assist');
    assert.ok(conn, 'Should return connector');
    assert.strictEqual(conn.product_name, 'Now Assist');
});

// Test 8: getConnector — not found
test('TowerCore.getConnector — returns null for unknown product', function() {
    var si = loadSIEval('TowerCore.js');
    var core = new si.TowerCore();
    var conn = core.getConnector('Unknown Product');
    assert.strictEqual(conn, null);
});

// Test 9: getInstances
test('TowerCore.getInstances — returns active instances', function() {
    var si = loadSIEval('TowerCore.js');
    mock.seedTable('x_snc_ai_tower_config', [
        { sys_id: 'inst_001', config_type: 'instance', name: 'PROD-US', url: 'https://prod-us', active: 'true' },
        { sys_id: 'inst_002', config_type: 'instance', name: 'PROD-EU', url: 'https://prod-eu', active: 'true' },
        { sys_id: 'inst_003', config_type: 'connector', product_name: 'X', active: 'true' }
    ]);
    var core = new si.TowerCore();
    var instances = core.getInstances();
    assert.strictEqual(instances.length, 2, 'Should return 2 active instances, got ' + instances.length);
});

// ─── TowerAnalytics Tests ───
console.log('\n═══ TowerAnalytics Tests ═══');

// Test 10: computeMetric — requests
test('TowerAnalytics.computeMetric — counts requests', function() {
    var si = loadSIEval('TowerAnalytics.js');
    mock.seedTable('x_snc_ai_tower_record', [
        { record_type: 'usage', request_count: '5', success_count: '4', failure_count: '1', user_sysid: 'u1' },
        { record_type: 'usage', request_count: '3', success_count: '3', failure_count: '0', user_sysid: 'u2' }
    ]);
    var analytics = new si.TowerAnalytics();
    var gr = new mock.GlideRecord('x_snc_ai_tower_record');
    gr.addQuery('record_type', 'usage');
    gr.query();
    var result = analytics.computeMetric('requests', gr);
    assert.strictEqual(result, 8, 'Expected 8 total requests, got ' + result);
});

// Test 11: computeMetric — success_rate
test('TowerAnalytics.computeMetric — calculates success rate', function() {
    var si = loadSIEval('TowerAnalytics.js');
    mock.seedTable('x_snc_ai_tower_record', [
        { record_type: 'usage', request_count: '10', success_count: '8', failure_count: '2', user_sysid: 'u1' }
    ]);
    var analytics = new si.TowerAnalytics();
    var gr = new mock.GlideRecord('x_snc_ai_tower_record');
    gr.addQuery('record_type', 'usage');
    gr.query();
    var result = analytics.computeMetric('success_rate', gr);
    assert.strictEqual(result, 80, 'Expected 80% success rate, got ' + result);
});

// Test 12: computeMetric — active_users
test('TowerAnalytics.computeMetric — counts active users', function() {
    var si = loadSIEval('TowerAnalytics.js');
    mock.seedTable('x_snc_ai_tower_record', [
        { record_type: 'usage', user_sysid: 'u1', request_count: '1' },
        { record_type: 'usage', user_sysid: 'u2', request_count: '1' },
        { record_type: 'usage', user_sysid: 'u1', request_count: '1' },
        { record_type: 'usage', user_sysid: 'u3', request_count: '1' }
    ]);
    var analytics = new si.TowerAnalytics();
    var gr = new mock.GlideRecord('x_snc_ai_tower_record');
    gr.addQuery('record_type', 'usage');
    gr.query();
    var result = analytics.computeMetric('active_users', gr);
    assert.strictEqual(result, 3, 'Expected 3 unique users, got ' + result);
});

// Test 13: computeMetric — failure_rate
test('TowerAnalytics.computeMetric — calculates failure rate', function() {
    var si = loadSIEval('TowerAnalytics.js');
    mock.seedTable('x_snc_ai_tower_record', [
        { record_type: 'usage', request_count: '10', success_count: '7', failure_count: '3', user_sysid: 'u1' }
    ]);
    var analytics = new si.TowerAnalytics();
    var gr = new mock.GlideRecord('x_snc_ai_tower_record');
    gr.addQuery('record_type', 'usage');
    gr.query();
    var result = analytics.computeMetric('failure_rate', gr);
    assert.strictEqual(result, 30, 'Expected 30% failure rate, got ' + result);
});

// Test 14: calculateROI
test('TowerAnalytics.calculateROI — calculates hours and cost saved', function() {
    var si = loadSIEval('TowerAnalytics.js');
    mock.seedTable('x_snc_ai_tower_record', [
        { record_type: 'usage', instance: 'inst_001', product: 'Now Assist', capability: 'Catalog Item Generation', request_count: '10', success_count: '8', failure_count: '2' }
    ]);
    var analytics = new si.TowerAnalytics();
    var result = analytics.calculateROI('inst_001', {});
    assert.ok(result.interactions > 0, 'Should have interactions');
    assert.ok(result.hours_saved > 0, 'Should have hours saved');
    assert.ok(result.cost_saved > 0, 'Should have cost saved');
    // 10 interactions × 45 min = 450 min = 7.5 hours
    assert.ok(Math.abs(result.hours_saved - 7.5) < 1, 'Expected ~7.5 hours, got ' + result.hours_saved);
});

// Test 15: queryMetrics
test('TowerAnalytics.queryMetrics — returns metrics with filters', function() {
    var si = loadSIEval('TowerAnalytics.js');
    mock.seedTable('x_snc_ai_tower_record', [
        { sys_id: 'm1', record_type: 'metric', instance: 'inst_001', product: 'Now Assist', metric_type: 'requests', metric_value: '100', period_end: '2026-08-18 12:00:00' },
        { sys_id: 'm2', record_type: 'metric', instance: 'inst_001', product: 'Build Agent', metric_type: 'requests', metric_value: '50', period_end: '2026-08-18 12:00:00' }
    ]);
    var analytics = new si.TowerAnalytics();
    var results = analytics.queryMetrics({ product: 'Now Assist', limit: 10 });
    assert.strictEqual(results.length, 1, 'Expected 1 metric for Now Assist');
    assert.strictEqual(results[0].metric_value, 100);
});

// ─── TowerGovernance Tests ───
console.log('\n═══ TowerGovernance Tests ═══');

// Test 16: createAlert
test('TowerGovernance.createAlert — creates alert record', function() {
    var si = loadSIEval('TowerGovernance.js');
    mock.seedTable('x_snc_ai_tower_config', [
        { sys_id: 'inst_001', config_type: 'instance', name: 'PROD-US', active: 'true' }
    ]);
    var gov = new si.TowerGovernance();
    var id = gov.createAlert({
        type: 'success_rate_drop',
        severity: 'warning',
        instance: 'inst_001',
        title: 'Success rate dropped',
        description: 'Rate dropped from 90% to 75%',
        recommended_action: 'Check configuration'
    });
    assert.ok(id, 'Should return alert sys_id');
    var alerts = mock.getTable('x_snc_ai_tower_alert');
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(alerts[0].type, 'success_rate_drop');
    assert.strictEqual(alerts[0].status, 'new');
});

// Test 17: createAlert — dedup
test('TowerGovernance.createAlert — deduplicates existing unresolved alert', function() {
    var si = loadSIEval('TowerGovernance.js');
    mock.seedTable('x_snc_ai_tower_alert', [
        { sys_id: 'alert_001', type: 'success_rate_drop', instance: 'inst_001', product: '', status: 'new', title: 'Old alert', description: 'Old desc' }
    ]);
    var gov = new si.TowerGovernance();
    var id = gov.createAlert({
        type: 'success_rate_drop',
        severity: 'warning',
        instance: 'inst_001',
        title: 'New alert',
        description: 'New desc'
    });
    var alerts = mock.getTable('x_snc_ai_tower_alert');
    assert.strictEqual(alerts.length, 1, 'Should not create duplicate — should update existing');
    assert.strictEqual(alerts[0].description, 'New desc', 'Should update description');
});

// Test 18: acknowledgeAlert
test('TowerGovernance.acknowledgeAlert — updates status to acknowledged', function() {
    var si = loadSIEval('TowerGovernance.js');
    mock.seedTable('x_snc_ai_tower_alert', [
        { sys_id: 'alert_001', type: 'success_rate_drop', status: 'new', instance: 'inst_001' }
    ]);
    var gov = new si.TowerGovernance();
    var result = gov.acknowledgeAlert('alert_001', 'user_001');
    assert.strictEqual(result, true);
    var alerts = mock.getTable('x_snc_ai_tower_alert');
    assert.strictEqual(alerts[0].status, 'acknowledged');
    assert.strictEqual(alerts[0].acknowledged_by, 'user_001');
});

// Test 19: resolveAlert
test('TowerGovernance.resolveAlert — updates status to resolved', function() {
    var si = loadSIEval('TowerGovernance.js');
    mock.seedTable('x_snc_ai_tower_alert', [
        { sys_id: 'alert_001', type: 'failure_spike', status: 'acknowledged', instance: 'inst_001' }
    ]);
    var gov = new si.TowerGovernance();
    var result = gov.resolveAlert('alert_001', 'user_001', 'Fixed config');
    assert.strictEqual(result, true);
    var alerts = mock.getTable('x_snc_ai_tower_alert');
    assert.strictEqual(alerts[0].status, 'resolved');
    assert.strictEqual(alerts[0].resolution_note, 'Fixed config');
});

// Test 20: acknowledgeAlert — not found
test('TowerGovernance.acknowledgeAlert — returns false for non-existent alert', function() {
    var si = loadSIEval('TowerGovernance.js');
    var gov = new si.TowerGovernance();
    var result = gov.acknowledgeAlert('nonexistent', 'user_001');
    assert.strictEqual(result, false);
});

// Test 21: getAlerts — with filters
test('TowerGovernance.getAlerts — filters by severity', function() {
    var si = loadSIEval('TowerGovernance.js');
    mock.seedTable('x_snc_ai_tower_alert', [
        { sys_id: 'a1', type: 'success_rate_drop', severity: 'critical', status: 'new', instance: 'inst_001', title: 'T1', detected_at: '2026-08-18 10:00:00' },
        { sys_id: 'a2', type: 'adoption_gap', severity: 'warning', status: 'new', instance: 'inst_001', title: 'T2', detected_at: '2026-08-18 11:00:00' },
        { sys_id: 'a3', type: 'failure_spike', severity: 'critical', status: 'resolved', instance: 'inst_001', title: 'T3', detected_at: '2026-08-18 12:00:00' }
    ]);
    var gov = new si.TowerGovernance();
    var results = gov.getAlerts({ severity: 'critical' });
    assert.strictEqual(results.length, 2, 'Expected 2 critical alerts, got ' + results.length);
});

// Test 22: getAlerts — filter by status
test('TowerGovernance.getAlerts — filters by status', function() {
    var si = loadSIEval('TowerGovernance.js');
    mock.seedTable('x_snc_ai_tower_alert', [
        { sys_id: 'a1', type: 't1', severity: 'warning', status: 'new', instance: 'i1', title: 'T1', detected_at: '2026-08-18 10:00:00' },
        { sys_id: 'a2', type: 't2', severity: 'warning', status: 'resolved', instance: 'i1', title: 'T2', detected_at: '2026-08-18 11:00:00' }
    ]);
    var gov = new si.TowerGovernance();
    var results = gov.getAlerts({ status: 'resolved' });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].title, 'T2');
});

// Test 23: translateQuery — Now Assist + HR
test('TowerGovernance.translateQuery — translates Now Assist HR query', function() {
    var si = loadSIEval('TowerGovernance.js');
    var gov = new si.TowerGovernance();
    var result = gov.translateQuery('show me Now Assist adoption in HR department');
    assert.ok(result.encoded_query.indexOf('product=Now Assist') >= 0, 'Should contain product filter');
    assert.ok(result.encoded_query.indexOf('department=HR') >= 0, 'Should contain department filter');
});

// Test 24: translateQuery — empty query
test('TowerGovernance.translateQuery — handles empty query', function() {
    var si = loadSIEval('TowerGovernance.js');
    var gov = new si.TowerGovernance();
    var result = gov.translateQuery('');
    assert.strictEqual(result.encoded_query, '');
});

// Test 25: translateQuery — Build Agent + failure
test('TowerGovernance.translateQuery — translates Build Agent failure query', function() {
    var si = loadSIEval('TowerGovernance.js');
    var gov = new si.TowerGovernance();
    var result = gov.translateQuery('show Build Agent failure rates');
    assert.ok(result.encoded_query.indexOf('product=Build Agent') >= 0);
    assert.ok(result.encoded_query.indexOf('metric_type=failure_rate') >= 0);
});

// Test 26: executeQuery
test('TowerGovernance.executeQuery — returns matching records', function() {
    var si = loadSIEval('TowerGovernance.js');
    mock.seedTable('x_snc_ai_tower_record', [
        { sys_id: 'r1', record_type: 'usage', product: 'Now Assist', user_name: 'john', department: 'IT', request_count: '5', success_count: '4', failure_count: '1', sync_timestamp: '2026-08-18 10:00:00' },
        { sys_id: 'r2', record_type: 'execution', product: 'Build Agent', user_name: 'jane', department: 'HR', request_count: '1', success_count: '0', failure_count: '1', sync_timestamp: '2026-08-18 11:00:00' }
    ]);
    var gov = new si.TowerGovernance();
    var results = gov.executeQuery('product=Now Assist', 10);
    assert.strictEqual(results.length, 1, 'Expected 1 result for Now Assist');
    assert.strictEqual(results[0].user_name, 'john');
});

// Test 27: detectAll — creates alerts for stale instances
test('TowerGovernance.detectAll — detects stale sync (>48h = critical)', function() {
    var si = loadSIEval('TowerGovernance.js');
    var staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - 3); // 3 days ago — well over 48h
    var staleStr = staleDate.getFullYear() + '-' +
        String(staleDate.getMonth() + 1).padStart(2, '0') + '-' +
        String(staleDate.getDate()).padStart(2, '0') + ' ' +
        String(staleDate.getHours()).padStart(2, '0') + ':00:00';
    mock.seedTable('x_snc_ai_tower_config', [
        { sys_id: 'inst_001', config_type: 'instance', name: 'PROD-US', active: 'true', last_sync: staleStr }
    ]);
    var gov = new si.TowerGovernance();
    var result = gov.detectAll();
    assert.ok(result.alerts_created >= 1, 'Should create stale_data alert');
    var alerts = mock.getTable('x_snc_ai_tower_alert');
    var staleAlert = alerts.find(function(a) { return a.type === 'stale_data'; });
    assert.ok(staleAlert, 'Should have stale_data alert');
    assert.strictEqual(staleAlert.severity, 'critical', '72h stale should be critical');
});

// Test 28: detectAll — no alert for recently synced instance
test('TowerGovernance.detectAll — no stale alert for recently synced instance', function() {
    var si = loadSIEval('TowerGovernance.js');
    mock.seedTable('x_snc_ai_tower_config', [
        { sys_id: 'inst_001', config_type: 'instance', name: 'PROD-US', active: 'true', last_sync: new Date().toISOString().replace('T', ' ').substr(0, 19) }
    ]);
    var gov = new si.TowerGovernance();
    gov.detectAll();
    var alerts = mock.getTable('x_snc_ai_tower_alert');
    var staleAlert = alerts.find(function(a) { return a.type === 'stale_data'; });
    assert.ok(!staleAlert, 'Should not have stale_data alert for recently synced instance');
});

// Test 29: detectAll — never synced instance creates stale alert
test('TowerGovernance.detectAll — never synced creates stale alert', function() {
    var si = loadSIEval('TowerGovernance.js');
    mock.seedTable('x_snc_ai_tower_config', [
        { sys_id: 'inst_001', config_type: 'instance', name: 'PROD-US', active: 'true', last_sync: '' }
    ]);
    var gov = new si.TowerGovernance();
    gov.detectAll();
    var alerts = mock.getTable('x_snc_ai_tower_alert');
    assert.ok(alerts.length >= 1, 'Should create alert for never-synced instance');
});

// Test 30: createAlert — alert lifecycle (create → ack → resolve)
test('TowerGovernance — full alert lifecycle (create → ack → resolve)', function() {
    var si = loadSIEval('TowerGovernance.js');
    mock.seedTable('x_snc_ai_tower_config', [
        { sys_id: 'inst_001', config_type: 'instance', name: 'PROD-US', active: 'true' }
    ]);
    var gov = new si.TowerGovernance();

    // Create
    var id = gov.createAlert({
        type: 'failure_spike',
        severity: 'critical',
        instance: 'inst_001',
        title: 'Failure spike detected',
        description: 'Failure rate 3x normal'
    });
    assert.ok(id, 'Create should return sys_id');

    // Acknowledge
    var ackResult = gov.acknowledgeAlert(id, 'admin_user');
    assert.strictEqual(ackResult, true);

    // Resolve
    var resolveResult = gov.resolveAlert(id, 'admin_user', 'Investigated and fixed');
    assert.strictEqual(resolveResult, true);

    // Verify final state
    var alerts = mock.getTable('x_snc_ai_tower_alert');
    assert.strictEqual(alerts[0].status, 'resolved');
    assert.strictEqual(alerts[0].resolution_note, 'Investigated and fixed');
});

// ─── Summary ───
console.log('\n═══════════════════════════════════════════');
console.log('  TEST RESULTS: ' + tests_passed + ' passed, ' + tests_failed + ' failed');
console.log('═══════════════════════════════════════════');

if (tests_failed > 0) {
    console.log('\nFailed tests:');
    test_results.filter(function(t) { return t.status === 'FAIL'; }).forEach(function(t) {
        console.log('  ❌ ' + t.name + ': ' + t.error);
    });
    process.exit(1);
} else {
    console.log('\n✅ ALL TESTS PASSED');
    process.exit(0);
}