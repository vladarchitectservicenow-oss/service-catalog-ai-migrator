// REST Medic — Scripted REST API Health Auditor
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// RESTMedicAlerter — Alert engine for threshold-based notifications
// when endpoint health drops below configured levels.
// @class RESTMedicAlerter @namespace x_vlad_rest_medic

var RESTMedicAlerter = Class.create();
RESTMedicAlerter.prototype = {
    initialize: function() {
        this.TABLE_ENDPOINT = 'x_vlad_rest_medic_endpoint';
        this.TABLE_CONFIG = 'x_vlad_rest_medic_config';
        this.TABLE_ALERT_LOG = 'x_vlad_rest_medic_config'; // reuse config table for alert log
    },

    /**
     * Check all endpoints against configured thresholds and send alerts.
     * @returns {Object} {alerts_sent, endpoints_checked}
     */
    checkThresholds: function() {
        var criticalThreshold = parseInt(this._getConfig('alert.threshold.critical', '50'), 10);
        var warningThreshold = parseInt(this._getConfig('alert.threshold.warning', '75'), 10);
        var cooldownHours = parseInt(this._getConfig('alert.cooldown_hours', '24'), 10);

        var gr = new GlideRecord(this.TABLE_ENDPOINT);
        gr.addQuery('health_score', '<=', warningThreshold);
        gr.query();

        var alertsSent = 0;
        var endpointsChecked = 0;

        while (gr.next()) {
            endpointsChecked++;
            var score = parseInt(gr.getValue('health_score') || '0', 10);
            var endpointName = gr.getValue('endpoint_name') || 'Unknown';
            var endpointPath = gr.getValue('endpoint_path') || '';
            var status = gr.getValue('status') || 'unknown';

            if (score <= criticalThreshold && !this.isCooldownActive(endpointPath, 'critical', cooldownHours)) {
                this.sendAlert(endpointPath, endpointName, score, status, 'critical');
                this._recordAlert(endpointPath, 'critical', score);
                alertsSent++;
            } else if (score <= warningThreshold && score > criticalThreshold && !this.isCooldownActive(endpointPath, 'warning', cooldownHours)) {
                this.sendAlert(endpointPath, endpointName, score, status, 'warning');
                this._recordAlert(endpointPath, 'warning', score);
                alertsSent++;
            }
        }

        return { alerts_sent: alertsSent, endpoints_checked: endpointsChecked };
    },

    /**
     * Send an alert via configured channels (email, Slack, Teams).
     * @param {string} endpointPath - API path
     * @param {string} endpointName - Display name
     * @param {number} score - Current health score
     * @param {string} status - healthy|warning|critical
     * @param {string} severity - critical|warning
     */
    sendAlert: function(endpointPath, endpointName, score, status, severity) {
        var subject = '[REST Medic] ' + severity.toUpperCase() + ': ' + endpointName + ' health score ' + score;
        var body = 'Endpoint: ' + endpointName + '\n' +
                   'Path: ' + endpointPath + '\n' +
                   'Health Score: ' + score + '/100\n' +
                   'Status: ' + status + '\n' +
                   'Severity: ' + severity + '\n\n' +
                   'View details in REST Medic Dashboard.';

        // Email alert
        var emailRecipients = this._getConfig('alert.email_recipients', '');
        if (emailRecipients) {
            try {
                var mail = new GlideEmailOutbound();
                mail.setSubject(subject);
                mail.setBody(body);
                mail.setTo(emailRecipients);
                mail.send();
            } catch (e) {
                // Fallback to gs.email.send() if GlideEmailOutbound unavailable
                try {
                    gs.email.send(emailRecipients, subject, body);
                } catch (e2) {
                    gs.error('RESTMedicAlerter: Email alert failed (both methods): ' + e2.toString());
                }
            }
        }

        // Slack webhook
        var slackWebhook = this._getConfig('alert.slack_webhook', '');
        if (slackWebhook) {
            try {
                var slackPayload = {
                    text: '*' + subject + '*\n```' + body + '```'
                };
                var rm = new sn_ws.RESTMessageV2();
                rm.setEndpoint(slackWebhook);
                rm.setHttpMethod('POST');
                rm.setRequestHeader('Content-Type', 'application/json');
                rm.setRequestBody(JSON.stringify(slackPayload));
                rm.execute();
            } catch (e) {
                gs.error('RESTMedicAlerter: Slack alert failed: ' + e.toString());
            }
        }

        // Teams webhook
        var teamsWebhook = this._getConfig('alert.teams_webhook', '');
        if (teamsWebhook) {
            try {
                var teamsPayload = {
                    '@type': 'MessageCard',
                    '@context': 'http://schema.org/extensions',
                    title: subject,
                    text: body.replace(/\n/g, '<br/>')
                };
                var rm2 = new sn_ws.RESTMessageV2();
                rm2.setEndpoint(teamsWebhook);
                rm2.setHttpMethod('POST');
                rm2.setRequestHeader('Content-Type', 'application/json');
                rm2.setRequestBody(JSON.stringify(teamsPayload));
                rm2.execute();
            } catch (e) {
                gs.error('RESTMedicAlerter: Teams alert failed: ' + e.toString());
            }
        }
    },

    /**
     * Check if an alert for this endpoint+severity is in cooldown.
     * @param {string} endpointPath - API path
     * @param {string} severity - critical|warning
     * @param {number} cooldownHours - Hours to suppress duplicates
     * @returns {boolean} True if alert is in cooldown
     */
    isCooldownActive: function(endpointPath, severity, cooldownHours) {
        var since = new GlideDateTime();
        since.addSeconds(-1 * cooldownHours * 3600);

        var gr = new GlideRecord(this.TABLE_ALERT_LOG);
        gr.addQuery('property_name', 'CONTAINS', 'alert_log.' + endpointPath + '.' + severity);
        gr.addQuery('sys_created_on', '>=', since);
        gr.setLimit(1);
        gr.query();

        return gr.next();
    },

    /**
     * Get alert history for all endpoints.
     * @param {number} hoursBack - Hours of history to retrieve (default 168 = 7 days)
     * @returns {Array} Alert log entries
     */
    getAlertHistory: function(hoursBack) {
        hoursBack = hoursBack || 168;
        var since = new GlideDateTime();
        since.addSeconds(-1 * hoursBack * 3600);

        var gr = new GlideRecord(this.TABLE_ALERT_LOG);
        gr.addQuery('property_name', 'STARTSWITH', 'alert_log.');
        gr.addQuery('sys_created_on', '>=', since);
        gr.orderByDesc('sys_created_on');
        gr.query();

        var alerts = [];
        while (gr.next()) {
            var propName = gr.getValue('property_name') || '';
            var parts = propName.split('.');
            alerts.push({
                timestamp: gr.getValue('sys_created_on') || '',
                endpoint_path: parts[2] || '',
                severity: parts[3] || '',
                score: gr.getValue('property_value') || '0'
            });
        }
        return alerts;
    },

    // ─── Private helpers ────────────────────────────────────────────

    _getConfig: function(name, defaultValue) {
        var gr = new GlideRecord(this.TABLE_CONFIG);
        gr.addQuery('property_name', name);
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return gr.getValue('property_value') || defaultValue;
        }
        return defaultValue;
    },

    _recordAlert: function(endpointPath, severity, score) {
        try {
            var gr = new GlideRecord(this.TABLE_ALERT_LOG);
            gr.initialize();
            gr.setValue('property_name', 'alert_log.' + endpointPath + '.' + severity);
            gr.setValue('property_value', String(score));
            gr.setValue('description', 'Alert sent: ' + severity + ' for ' + endpointPath + ' (score: ' + score + ')');
            gr.insert();
        } catch (e) {
            gs.error('RESTMedicAlerter: Failed to record alert: ' + e.toString());
        }
    },

    type: 'RESTMedicAlerter'
};
