// RESTPulse — Outbound REST Message & Integration Health Monitor
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// RESTPulseAlert — proactive alerting: evaluates health scores on a cadence,
// emits email + event on threshold breach, with quiet-hours and dedup windows.
//
// @class RESTPulseAlert
// @namespace x_snc_restpulse
var RESTPulseAlert = Class.create();
RESTPulseAlert.prototype = {

    initialize: function () {
        this.HEALTH_TABLE = 'x_snc_restpulse_health';
        this.CONFIG_TABLE = 'x_snc_restpulse_config';
        this.EVENT_NAME = 'sn_restpulse.health_breach';
        this._engine = new RESTPulseEngine();
    },

    /**
     * Evaluate all health records and emit alerts for any that crossed a
     * degradation threshold and are not suppressed by quiet-hours or dedup.
     * @return {Object} {checked, alerted, suppressed_quiet, suppressed_dedup}
     */
    runAlertCycle: function () {
        var cfg = this._engine.getConfig();
        var result = { checked: 0, alerted: 0, suppressed_quiet: 0, suppressed_dedup: 0, breaches: [] };

        var inQuietHours = this._inQuietHours(cfg);
        var gr = new GlideRecord(this.HEALTH_TABLE);
        gr.addQuery('grade', 'IN', 'degraded,critical');
        gr.query();
        while (gr.next()) {
            result.checked++;
            var msgSysId = gr.getValue('message_sys_id');
            var msgName = gr.getValue('message_name') || msgSysId;
            var grade = gr.getValue('grade');
            var reasons = [];
            try {
                reasons = JSON.parse(gr.getValue('reasons_json') || '[]');
            } catch (e) {
                // ignore
            }

            var breach = {
                message_sys_id: msgSysId,
                message_name: msgName,
                grade: grade,
                reasons: reasons,
                endpoint: gr.getValue('endpoint') || ''
            };

            if (inQuietHours) {
                result.suppressed_quiet++;
                continue;
            }
            if (this._isDeduped(msgSysId, grade, cfg.alert_dedup_minutes)) {
                result.suppressed_dedup++;
                continue;
            }

            this._emitAlert(breach, cfg);
            this._recordAlert(msgSysId, grade);
            result.alerted++;
            result.breaches.push(breach);
        }
        return result;
    },

    /**
     * Determine if the current time falls within configured quiet hours.
     * @param {Object} cfg
     * @return {boolean}
     */
    _inQuietHours: function (cfg) {
        var now = new GlideDateTime();
        var hour = now.getHourLocalTime();
        var start = cfg.alert_quiet_hours_start;
        var end = cfg.alert_quiet_hours_end;
        if (start === end) { return false; }
        if (start < end) {
            return hour >= start && hour < end;
        }
        // wraps midnight
        return hour >= start || hour < end;
    },

    /**
     * Check whether an alert for this message+grade was already sent within
     * the dedup window.
     * @param {string} msgSysId
     * @param {string} grade
     * @param {number} dedupMinutes
     * @return {boolean}
     */
    _isDeduped: function (msgSysId, grade, dedupMinutes) {
        var since = new GlideDateTime();
        since.addMinutes(-1 * (dedupMinutes || 60));
        var gr = new GlideRecord(this.CONFIG_TABLE);
        gr.addQuery('type', 'alert_log');
        gr.addQuery('name', msgSysId + ':' + grade);
        gr.addQuery('sys_created_on', '>=', since);
        gr.setLimit(1);
        gr.query();
        return gr.next();
    },

    /**
     * Emit an email and a platform event for a breach.
     * @param {Object} breach
     * @param {Object} cfg
     */
    _emitAlert: function (breach, cfg) {
        var subject = 'RESTPulse: ' + breach.grade.toUpperCase() + ' — ' + breach.message_name;
        var body = 'Integration "' + breach.message_name + '" is ' + breach.grade + '.\n\n' +
            'Endpoint: ' + (breach.endpoint || '(unknown)') + '\n' +
            'Reasons:\n' + (breach.reasons.length ? ' - ' + breach.reasons.join('\n - ') : ' - (none)') + '\n\n' +
            'Review the RESTPulse dashboard for full telemetry and dependency impact.';

        // Email
        var recipients = cfg.alert_email_recipients;
        if (recipients) {
            try {
                var mail = new GlideEmailOutbound();
                mail.setTo(recipients);
                mail.setSubject(subject);
                mail.setBody(body);
                mail.send();
            } catch (e) {
                gs.error('RESTPulse: email alert failed. ' + e);
            }
        }

        // Event
        try {
            gs.eventQueue(this.EVENT_NAME, null, breach.message_sys_id, breach.message_name);
        } catch (e) {
            gs.error('RESTPulse: eventQueue failed. ' + e);
        }
    },

    /**
     * Record an alert in the config table (type=alert_log) for dedup.
     * @param {string} msgSysId
     * @param {string} grade
     */
    _recordAlert: function (msgSysId, grade) {
        var gr = new GlideRecord(this.CONFIG_TABLE);
        gr.initialize();
        gr.setValue('type', 'alert_log');
        gr.setValue('name', msgSysId + ':' + grade);
        gr.setValue('config_json', JSON.stringify({
            message_sys_id: msgSysId,
            grade: grade,
            alerted_at: new GlideDateTime().getValue()
        }));
        try {
            gr.insert();
        } catch (e) {
            gs.error('RESTPulse: _recordAlert insert failed. ' + e);
        }
    },

    type: 'RESTPulseAlert'
};
