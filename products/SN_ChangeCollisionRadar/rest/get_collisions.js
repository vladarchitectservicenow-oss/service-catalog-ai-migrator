// ChangeCollision Radar — GET /collisions
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Returns the collision snapshot and risk rows. Optional ?ci=<sys_id>
// filters collisions to a single CI.
(function process(request, response) {

    var engine = new CollisionRadarEngine();
    var ci = request.queryParams.ci || null;

    var data = engine.snapshot(ci);
    var payload = {
        ok: true,
        count: data.collisions.length,
        collisions: data.collisions,
        risk: data.risk
    };

    response.setStatus(200);
    response.setBody(JSON.stringify(payload));

})(request, response);
