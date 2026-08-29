// BR Medic — GET /status (read-only reporting endpoint)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Read-only endpoint. Dispatches on query parameters:
//   ?report=<scan_id>      → ranked anti-pattern report
//   ?health=<scan_id>      → per-script health dashboard
//   ?workbench=<scan_id>   → remediation workbench (findings + suggested fix)
//   ?markdown=<scan_id>    → Markdown export of the report
//   ?csv=<scan_id>         → CSV export of the report
// Returns HTTP 400 when no recognized parameter is supplied, and a structured
// HTTP 500 on any unexpected error (no raw stack traces leak to the caller).

(function process(request, response) {
    try {
        var q = request.queryParams || {};
        var report = new BrmReport();
        var result = { queried_at: new GlideDateTime().getValue() };

        if (q.report) {
            result.report = report.buildReport(q.report);
        } else if (q.health) {
            result.health = report.buildHealthDashboard(q.health);
        } else if (q.workbench) {
            result.workbench = report.buildWorkbench(q.workbench);
        } else if (q.markdown) {
            result.markdown = report.exportMarkdown(q.markdown);
        } else if (q.csv) {
            result.csv = report.exportCsv(q.csv);
        } else {
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'No recognized query parameter supplied',
                valid_params: ['report', 'health', 'workbench', 'markdown', 'csv']
            }));
            return;
        }

        response.setStatus(200);
        response.setBody(JSON.stringify(result));
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({
            error: 'Internal error processing request',
            message: e.message || 'unknown error'
        }));
    }
})(request, response);
