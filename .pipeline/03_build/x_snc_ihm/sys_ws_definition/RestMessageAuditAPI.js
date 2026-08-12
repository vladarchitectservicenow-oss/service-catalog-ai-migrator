var RestMessageAuditAPI = Class.create();
RestMessageAuditAPI.prototype = {
    initialize: function() {},

    /**
     * GET /api/x_snc_ihm/v1/audits
     * Parameters: state (healthy|warning|critical), min_score (0-100)
     */
    process: function(httpRequest, httpResponse) {
        try {
            var state = httpRequest.getParameter('state');
            var minScore = parseInt(httpRequest.getParameter('min_score') || '0', 10);
            var limit = parseInt(httpRequest.getParameter('limit') || '50', 10);

            var gr = new GlideRecord('x_snc_ihm_integration_audit');
            if (state) gr.addQuery('state', state);
            if (minScore > 0) gr.addQuery('health_score', '>=', minScore);
            gr.setLimit(limit);
            gr.orderByDesc('health_score');
            gr.query();

            var results = [];
            while (gr.next()) {
                results.push({
                    sys_id: gr.getValue('sys_id'),
                    integration: gr.getValue('integration'),
                    integration_name: gr.getValue('integration_name'),
                    endpoint: gr.getValue('endpoint'),
                    health_score: parseInt(gr.getValue('health_score'), 10),
                    state: gr.getValue('state'),
                    findings: (gr.getValue('findings') || '').split('\n'),
                    age_days: parseInt(gr.getValue('age_days') || '0', 10),
                    assessed_on: gr.getValue('assessed_on')
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

    type: 'RestMessageAuditAPI'
};
