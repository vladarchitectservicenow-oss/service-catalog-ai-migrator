/**
 * ExecuteAPI — REST handler for POST /api/x_snc_uibm/v1/execute
 * Scoped App: x_snc_uibm
 *
 * Dispatches action-based requests: scan, analyze, metrics, safe-mode, etc.
 * This Script Include is referenced by the scripted REST resource "execute".
 */

var ExecuteAPI = Class.create();
ExecuteAPI.prototype = {
    initialize: function() {
        this.scope = 'x_snc_uibm';
    },

    /**
     * Main entry point — called by the scripted REST resource.
     * @param {RESTAPIRequest} request
     * @param {RESTAPIResponse} response
     */
    process: function(request, response) {
        var body = request.body;
        var data = {};
        try { data = JSON.parse(body); } catch (e) { data = {}; }

        var action = data.action || '';
        var result;

        switch (action) {
            case 'scan':
                var core = new UIBMCore();
                result = core.scanPage(data.page_sys_id);
                break;

            case 'full-scan':
                var coreScan = new UIBMCore();
                result = coreScan.scanAllPages();
                break;

            case 'analyze':
                var analyzer = new UIBMAnalyzer();
                result = analyzer.analyzeDependencies(data.page_sys_id);
                break;

            case 'full-analysis':
                var analyzerFull = new UIBMAnalyzer();
                result = analyzerFull.runFullAnalysis();
                break;

            case 'orphan-scan':
                var analyzerOrphan = new UIBMAnalyzer();
                result = analyzerOrphan.detectOrphanedComponents();
                break;

            case 'metrics':
                var coreMetrics = new UIBMCore();
                result = coreMetrics.receiveMetrics(data);
                break;

            case 'safe-mode-enable':
                var coreSafe = new UIBMCore();
                result = coreSafe.enableSafeMode(data.page_sys_id);
                break;

            case 'safe-mode-disable':
                var coreSafeOff = new UIBMCore();
                result = coreSafeOff.disableSafeMode(data.page_sys_id);
                break;

            case 'disable-component':
                var coreDisable = new UIBMCore();
                result = coreDisable.disableComponent(data.page_sys_id, data.component_sys_id);
                break;

            case 'recommend':
                var coreRec = new UIBMCore();
                result = coreRec.getRecommendations(data.page_sys_id);
                break;

            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({
                    ok: false,
                    error: { message: "Unknown action: " + action, details: "Valid actions: scan, full-scan, analyze, full-analysis, orphan-scan, metrics, safe-mode-enable, safe-mode-disable, disable-component, recommend" }
                }));
                return;
        }

        response.setStatus(result.ok ? 200 : 500);
        response.setBody(JSON.stringify(result));
    },

    type: 'ExecuteAPI'
};