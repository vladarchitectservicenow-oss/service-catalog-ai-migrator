// ScopeBridge — ScopeBridge API (GET status)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Scripted REST API — GET /x_snb/scope_bridge/status
// Read-only reporting endpoint. Dispatches on the `view` query parameter:
//   view = "scan"     -> scan header for a given scan_sys_id
//   view = "refs"     -> reference list (optionally filtered by ?status=)
//   view = "matrix"   -> coverage matrix for a scan
//   (default)         -> endpoint health + engine version
// Unknown scan ids return HTTP 404; unknown views return HTTP 400.
(function process(request, response) {

    var view = request.queryParams.view || null;
    var scanner = new x_snb.ScopeBridgeScanner();

    try {
        if (!view) {
            response.setStatus(200);
            response.setBody(JSON.stringify({
                ok: true,
                service: 'ScopeBridge',
                engine_version: scanner.ENGINE_VERSION,
                capabilities: ['scan', 'refs', 'matrix']
            }));
            return;
        }

        switch (view) {
            case 'scan': {
                var sid = request.queryParams.scan_sys_id;
                if (!sid) {
                    response.setStatus(400);
                    response.setBody(JSON.stringify({ ok: false, error: 'Missing query parameter: scan_sys_id' }));
                    return;
                }
                var scan = scanner.getScan(sid);
                if (!scan) {
                    response.setStatus(404);
                    response.setBody(JSON.stringify({ ok: false, error: 'Scan not found: ' + sid }));
                    return;
                }
                response.setStatus(200);
                response.setBody(JSON.stringify({ ok: true, scan: scan }));
                return;
            }

            case 'refs': {
                var rsid = request.queryParams.scan_sys_id;
                if (!rsid) {
                    response.setStatus(400);
                    response.setBody(JSON.stringify({ ok: false, error: 'Missing query parameter: scan_sys_id' }));
                    return;
                }
                var statusFilter = request.queryParams.status || null;
                var refs = scanner.listReferences(rsid, statusFilter);
                response.setStatus(200);
                response.setBody(JSON.stringify({ ok: true, references: refs, count: refs.length }));
                return;
            }

            case 'matrix': {
                var msid = request.queryParams.scan_sys_id;
                if (!msid) {
                    response.setStatus(400);
                    response.setBody(JSON.stringify({ ok: false, error: 'Missing query parameter: scan_sys_id' }));
                    return;
                }
                var matrix = scanner.getCoverageMatrix(msid);
                response.setStatus(200);
                response.setBody(JSON.stringify({ ok: true, matrix: matrix }));
                return;
            }

            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({
                    ok: false,
                    error: 'Unknown view: ' + view,
                    allowed: ['scan', 'refs', 'matrix']
                }));
                return;
        }
    } catch (e) {
        gs.error('ScopeBridge status endpoint: unhandled error for view ' + view + ': ' + e.message);
        response.setStatus(500);
        response.setBody(JSON.stringify({ ok: false, error: 'Internal error: ' + e.message }));
    }

})(request, response);
