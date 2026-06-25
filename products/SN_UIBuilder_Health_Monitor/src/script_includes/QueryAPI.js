/**
 * QueryAPI — REST handler for GET /api/x_snc_uibm/v1/query
 * Scoped App: x_snc_uibm
 *
 * Dispatches type-based query requests: health, gate, findings, etc.
 * This Script Include is referenced by the scripted REST resource "query".
 */

var QueryAPI = Class.create();
QueryAPI.prototype = {
    initialize: function() {
        this.scope = 'x_snc_uibm';
    },

    /**
     * Main entry point — called by the scripted REST resource.
     * @param {RESTAPIRequest} request
     * @param {RESTAPIResponse} response
     */
    process: function(request, response) {
        var type = request.queryParams.type || '';
        var params = request.queryParams;
        var result;

        switch (type) {
            case 'health':
                if (!params.page_sys_id) {
                    response.setStatus(400);
                    response.setBody(JSON.stringify({ ok: false, error: "page_sys_id required for type=health" }));
                    return;
                }
                var coreHealth = new UIBMCore();
                result = coreHealth.getHealthScore(params.page_sys_id);
                break;

            case 'gate':
                var coreGate = new UIBMCore();
                var threshold = params.gate_threshold ? parseInt(params.gate_threshold, 10) : null;
                result = coreGate.getInstanceHealth(threshold);
                break;

            case 'findings':
                var analyzerFindings = new UIBMAnalyzer();
                result = analyzerFindings.getFindings({
                    page_sys_id: params.page_sys_id,
                    finding_type: params.finding_type,
                    severity: params.severity,
                    status: params.status,
                    scan_run_id: params.scan_run_id,
                    limit: params.limit
                });
                break;

            case 'recommendations':
                var analyzerRecs = new UIBMAnalyzer();
                result = analyzerRecs.getRecommendations({
                    page_sys_id: params.page_sys_id,
                    severity: params.severity,
                    status: params.status,
                    category: params.category,
                    limit: params.limit
                });
                break;

            case 'safe-mode':
                var analyzerSafe = new UIBMAnalyzer();
                result = analyzerSafe.getSafeModeSessions();
                break;

            case 'report':
                var analyzerReport = new UIBMAnalyzer();
                result = analyzerReport.getWeeklyReport();
                break;

            case 'pages':
                result = this._getAllPageHealthRecords(params.limit || 200);
                break;

            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({
                    ok: false,
                    error: { message: "Unknown type: " + type, details: "Valid types: health, gate, findings, recommendations, safe-mode, report, pages" }
                }));
                return;
        }

        response.setStatus(result.ok ? 200 : 500);
        response.setBody(JSON.stringify(result));
    },

    _getAllPageHealthRecords: function(limit) {
        try {
            var gr = new GlideRecord('x_snc_uibm_page_health');
            gr.orderByDesc('last_scanned');
            gr.setLimit(parseInt(limit, 10));
            gr.query();

            var pages = [];
            while (gr.next()) {
                pages.push({
                    sys_id: gr.getUniqueValue(),
                    page_sys_id: gr.page_sys_id.toString(),
                    page_name: gr.page_name.toString(),
                    complexity_score: parseInt(gr.complexity_score.toString() || '0', 10),
                    score_category: gr.score_category.toString(),
                    component_count: parseInt(gr.component_count.toString() || '0', 10),
                    nesting_depth: parseInt(gr.nesting_depth.toString() || '0', 10),
                    avg_load_ms: parseInt(gr.avg_load_ms.toString() || '0', 10),
                    perf_trend: gr.perf_trend.toString(),
                    critical_findings: parseInt(gr.critical_findings.toString() || '0', 10),
                    warning_findings: parseInt(gr.warning_findings.toString() || '0', 10),
                    safe_mode_active: gr.safe_mode_active ? gr.safe_mode_active.booleanValue() : false,
                    last_scanned: gr.last_scanned ? gr.last_scanned.toString() : ''
                });
            }
            return { ok: true, data: { count: pages.length, pages: pages } };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    },

    type: 'QueryAPI'
};