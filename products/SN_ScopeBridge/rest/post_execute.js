// ScopeBridge — ScopeBridge API (POST execute)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Scripted REST API — POST /x_snb/scope_bridge/execute
// Single action-dispatch endpoint consolidating every write/command operation:
//   action = "scan"     -> run a full/incremental scan of a target scope
//   action = "generate" -> dry-run (default) or apply least-privilege records
//   action = "audit"    -> over-privilege auditor over the whole instance
//   action = "drift"    -> diff privileges between two scans
// Unknown/absent action -> HTTP 400 with a structured error body.
(function process(request, response) {

    var body = request.body ? request.body.data : null;
    var action = body && body.action ? body.action : null;

    if (!action) {
        response.setStatus(400);
        response.setBody(JSON.stringify({
            ok: false,
            error: 'Missing required field: action',
            allowed: ['scan', 'generate', 'audit', 'drift']
        }));
        return;
    }

    var scanner = new x_snb.ScopeBridgeScanner();
    var generator = new x_snb.ScopeBridgeGenerator();

    try {
        switch (action) {
            case 'scan': {
                var scope = body.target_scope;
                if (!scope) {
                    response.setStatus(400);
                    response.setBody(JSON.stringify({ ok: false, error: 'Missing required field: target_scope' }));
                    return;
                }
                var mode = body.mode || 'full';
                var scanSysId = scanner.run(scope, mode);
                if (!scanSysId) {
                    response.setStatus(500);
                    response.setBody(JSON.stringify({ ok: false, error: 'Scan failed to initialize' }));
                    return;
                }
                response.setStatus(200);
                response.setBody(JSON.stringify({ ok: true, scan_sys_id: scanSysId, target_scope: scope, mode: mode }));
                return;
            }

            case 'generate': {
                var sid = body.scan_sys_id;
                if (!sid) {
                    response.setStatus(400);
                    response.setBody(JSON.stringify({ ok: false, error: 'Missing required field: scan_sys_id' }));
                    return;
                }
                var apply = body.apply === true;
                var result = generator.generate(sid, apply);
                response.setStatus(200);
                response.setBody(JSON.stringify({ ok: true, result: result }));
                return;
            }

            case 'audit': {
                var findings = scanner.auditOverPrivilege();
                response.setStatus(200);
                response.setBody(JSON.stringify({ ok: true, findings: findings, count: findings.length }));
                return;
            }

            case 'drift': {
                var scanA = body.scan_a;
                var scanB = body.scan_b;
                if (!scanA || !scanB) {
                    response.setStatus(400);
                    response.setBody(JSON.stringify({ ok: false, error: 'Missing required fields: scan_a and scan_b' }));
                    return;
                }
                var drift = scanner.driftBetween(scanA, scanB);
                response.setStatus(200);
                response.setBody(JSON.stringify({ ok: true, drift: drift }));
                return;
            }

            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({
                    ok: false,
                    error: 'Unknown action: ' + action,
                    allowed: ['scan', 'generate', 'audit', 'drift']
                }));
                return;
        }
    } catch (e) {
        gs.error('ScopeBridge execute endpoint: unhandled error for action ' + action + ': ' + e.message);
        response.setStatus(500);
        response.setBody(JSON.stringify({ ok: false, error: 'Internal error: ' + e.message }));
    }

})(request, response);
