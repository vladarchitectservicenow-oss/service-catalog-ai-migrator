// Notification Trace — REST API: GET /api/x_ntrc/health
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Query-parameter dispatch endpoint for health/dashboard data.
// Query params: ?metric=summary|overlaps|failures|rules|timeline

(function process(request, response) {

    var analyzer = new TraceAnalyzer();
    var tracer = new NotificationTracer();
    var queryParams = request.queryParams;
    var metric = queryParams.metric || 'summary';

    try {
        switch (metric) {
            case 'summary':
                _handleSummary(analyzer, response);
                break;

            case 'overlaps':
                _handleOverlaps(analyzer, response);
                break;

            case 'failures':
                _handleFailures(tracer, queryParams, response);
                break;

            case 'rules':
                _handleRules(analyzer, response);
                break;

            case 'timeline':
                _handleTimeline(tracer, analyzer, queryParams, response);
                break;

            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({
                    error: 'Unknown metric: ' + metric,
                    valid_metrics: ['summary', 'overlaps', 'failures', 'rules', 'timeline']
                }));
        }
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({
            error: 'Internal error: ' + e.toString(),
            metric: metric
        }));
    }

    /**
     * Return a comprehensive health summary.
     */
    function _handleSummary(analyzer, response) {
        var health = analyzer.computeHealth();
        response.setStatus(200);
        response.setBody(JSON.stringify(health));
    }

    /**
     * Return current overlap pairs.
     */
    function _handleOverlaps(analyzer, response) {
        var overlaps = analyzer.detectOverlaps();
        response.setStatus(200);
        response.setBody(JSON.stringify({
            overlaps: overlaps,
            total: overlaps.length,
            generated_at: new GlideDateTime().getDisplayValue()
        }));
    }

    /**
     * Return silent failure report.
     * Optional: ?days_back=7
     */
    function _handleFailures(tracer, queryParams, response) {
        var daysBack = parseInt(queryParams.days_back, 10) || 1;
        var failures = tracer.detectSilentFailures(daysBack);
        response.setStatus(200);
        response.setBody(JSON.stringify(failures));
    }

    /**
     * Return rule statistics.
     */
    function _handleRules(analyzer, response) {
        var health = analyzer.computeHealth();
        response.setStatus(200);
        response.setBody(JSON.stringify({
            rule_stats: health.rule_stats,
            generated_at: health.generated_at
        }));
    }

    /**
     * Return timeline for a specific record.
     * Required: ?table_name=incident&record_sys_id=abc123
     */
    function _handleTimeline(tracer, analyzer, queryParams, response) {
        var tableName = queryParams.table_name;
        var recordSysId = queryParams.record_sys_id;

        if (!tableName || !recordSysId) {
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'Missing required parameters: table_name, record_sys_id'
            }));
            return;
        }

        var traceResult = tracer.traceRecord(tableName, recordSysId);
        var timeline = analyzer.generateTimeline(traceResult);

        response.setStatus(200);
        response.setBody(JSON.stringify({
            timeline: timeline,
            summary: traceResult.summary
        }));
    }

})(request, response);