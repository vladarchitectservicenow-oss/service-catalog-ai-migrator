// DedupeGuard — GET /candidates
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Returns the ranked duplicate-candidate list. Optional ?table=<name>
// filters to a single source table.
(function process(request, response) {

    var engine = new DedupeGuardEngine();
    var table = request.queryParams.get('table') || null;

    var candidates = engine.snapshot(table);
    var payload = {
        ok: true,
        count: candidates.length,
        candidates: candidates
    };

    response.setStatus(200);
    response.setBody(JSON.stringify(payload));

})(request, response);
