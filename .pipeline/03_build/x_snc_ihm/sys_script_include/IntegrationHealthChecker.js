var IntegrationHealthChecker = Class.create();
IntegrationHealthChecker.prototype = {
    initialize: function() {
        this.HEALTH_SCORE_WEIGHTS = {
            https: 30,
            endpoint_reachable: 30,
            credential_age_days: 20,
            active_status: 10,
            endpoint_entropy: 10
        };
    },

    /**
     * Scan all active sys_rest_message records and compute health scores.
     * @return {Array} [{ sys_id, name, endpoint, health_score, findings }]
     */
    scanAll: function() {
        var results = [];
        var gr = new GlideRecord('sys_rest_message');
        gr.addQuery('active', 'true');
        gr.query();
        while (gr.next()) {
            var record = this._assessIntegration(gr);
            results.push(record);
            this._persistAudit(record);
        }
        return results;
    },

    _assessIntegration: function(gr) {
        var endpoint = gr.getValue('endpoint') || '';
        var findings = [];
        var score = 0;

        // HTTPS validation
        if (endpoint.indexOf('https://') === 0) {
            score += this.HEALTH_SCORE_WEIGHTS.https;
        } else {
            findings.push('Endpoint does not use HTTPS');
        }

        // Endpoint reachability (naive URL validation)
        if (endpoint.length > 10 && endpoint.indexOf('.') > -1) {
            score += this.HEALTH_SCORE_WEIGHTS.endpoint_reachable;
        } else {
            findings.push('Malformed or empty endpoint');
        }

        // Credential age heuristic (last updated)
        var sysUpdated = gr.getValue('sys_updated_on');
        var ageDays = this._daysSince(sysUpdated);
        if (ageDays < 365) {
            score += this.HEALTH_SCORE_WEIGHTS.credential_age_days;
        } else {
            findings.push('Credentials may be stale (>365 days since update)');
        }

        // Active status
        if (gr.getValue('active') === 'true') {
            score += this.HEALTH_SCORE_WEIGHTS.active_status;
        }

        // Endpoint entropy (avoid hardcoded IPs, prefer domains)
        var ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
        var host = endpoint.replace(/^https?:\/\//, '').split('/')[0];
        if (!ipv4Pattern.test(host) && host.indexOf('.') > -1) {
            score += this.HEALTH_SCORE_WEIGHTS.endpoint_entropy;
        } else {
            findings.push('Endpoint uses IP address or malformed hostname');
        }

        // Bonus: name-based zombie detection
        var name = (gr.getValue('name') || '').toLowerCase();
        var zombieKeywords = ['legacy', 'old', 'deprecated', 'yahoo finance', 'test', 'sandbox'];
        for (var i = 0; i < zombieKeywords.length; i++) {
            if (name.indexOf(zombieKeywords[i]) > -1) {
                score = Math.max(0, score - 20);
                findings.push('Name contains zombie keyword: ' + zombieKeywords[i]);
                break;
            }
        }

        return {
            sys_id: gr.getValue('sys_id'),
            name: gr.getValue('name'),
            endpoint: endpoint,
            health_score: score,
            findings: findings,
            age_days: ageDays,
            assessed_on: new GlideDateTime().toString()
        };
    },

    _persistAudit: function(record) {
        var gr = new GlideRecord('x_snc_ihm_integration_audit');
        gr.initialize();
        gr.integration = record.sys_id;
        gr.integration_name = record.name;
        gr.endpoint = record.endpoint;
        gr.health_score = record.health_score;
        gr.findings = record.findings.join('\n');
        gr.age_days = record.age_days;
        gr.assessed_on = new GlideDateTime();
        gr.state = record.health_score >= 80 ? 'healthy' : record.health_score >= 50 ? 'warning' : 'critical';
        gr.insert();
    },

    _daysSince: function(dateString) {
        if (!dateString) return 9999;
        var then = new GlideDateTime(dateString);
        var now = new GlideDateTime();
        var diff = GlideDateTime.subtract(now, then);
        return parseInt(diff.getDayPart(), 10);
    },

    type: 'IntegrationHealthChecker'
};
