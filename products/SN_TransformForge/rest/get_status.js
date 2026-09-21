// TransformForge — REST Status Endpoint
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// GET read-only endpoint. Query parameters select the report shape:
//   ?job_sys_id=<id>  -> full preview for one generation job
//   ?list=true        -> recent job listing
//   (default)         -> engine version + recent job listing
(function process(request, response) {
    var q = request.queryParams || {};
    var gen = new TransformForgeGenerator();

    var result = { queried_at: new GlideDateTime().getValue() };

    // Full preview for a single job.
    if (q.job_sys_id) {
        var preview = gen.getJobPreview(q.job_sys_id);
        if (!preview.ok) {
            response.setStatus(404);
            response.setBody(JSON.stringify(preview));
            return;
        }
        response.setStatus(200);
        response.setBody(JSON.stringify(preview));
        return;
    }

    // Recent job listing.
    var limit = parseInt(q.limit || '25', 10);
    if (isNaN(limit) || limit < 1) { limit = 25; }
    if (limit > 100) { limit = 100; }

    result.engine_version = new TransformForgeEngine().ENGINE_VERSION;
    result.jobs = gen.listJobs(limit);
    result.count = result.jobs.length;

    response.setStatus(200);
    response.setBody(JSON.stringify(result));
})(request, response);
