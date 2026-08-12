var ScanResultAPI = Class.create();
ScanResultAPI.prototype = {
    initialize: function() {},

    /**
     * Handle GET /api/x_snc_cwi/v1/scan_results
     * Query parameters: run_id (optional), pattern (optional), state (optional)
     */
    process: function(httpRequest, httpResponse) {
        try {
            var runId = httpRequest.getParameter('run_id');
            var pattern = httpRequest.getParameter('pattern');
            var state = httpRequest.getParameter('state');
            var limit = parseInt(httpRequest.getParameter('limit') || '50', 10);

            var gr = new GlideRecord('x_snc_cwi_scan_result');
            if (runId) gr.addQuery('scan_run', runId);
            if (pattern) gr.addQuery('primary_pattern', pattern);
            if (state) gr.addQuery('state', state);
            gr.setLimit(limit);
            gr.orderByDesc('sys_created_on');
            gr.query();

            var results = [];
            while (gr.next()) {
                results.push({
                    sys_id: gr.getValue('sys_id'),
                    catalog_item: gr.getValue('catalog_item'),
                    catalog_item_name: gr.getValue('catalog_item_name'),
                    primary_pattern: gr.getValue('primary_pattern'),
                    confidence: parseInt(gr.getValue('confidence'), 10),
                    state: gr.getValue('state'),
                    scan_run: gr.getValue('scan_run'),
                    sys_created_on: gr.getValue('sys_created_on')
                });
            }

            httpResponse.setContentType('application/json');
            httpResponse.setStatus(200);
            httpResponse.getStreamWriter().writeString(JSON.stringify({ ok: true, count: results.length, data: results }));
        } catch (ex) {
            httpResponse.setStatus(500);
            httpResponse.getStreamWriter().writeString(JSON.stringify({ ok: false, error: ex.message }));
        }
    },

    type: 'ScanResultAPI'
};
