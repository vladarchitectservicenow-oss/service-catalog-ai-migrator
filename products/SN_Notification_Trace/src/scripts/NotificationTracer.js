// Notification Trace — NotificationTracer (Core Engine)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Core engine for tracing notification lifecycles: events → rules → emails → delivery.
// Handles all read/write operations against OOTB notification tables and custom trace storage.
// @class NotificationTracer @namespace x_ntrc

var NotificationTracer = Class.create();
NotificationTracer.prototype = {

    initialize: function() {
        this._traceResult = null;
    },

    /**
     * Trace the full notification lifecycle for a given record.
     * @param {string} tableName — source table (e.g. 'incident', 'sc_request')
     * @param {string} sysId — sys_id of the source record
     * @return {object} TraceResult with events, rule_matches, email_traces, delivery_statuses, summary
     */
    traceRecord: function(tableName, sysId) {
        var result = {
            source: { table: tableName, sys_id: sysId },
            events: [],
            rule_matches: [],
            email_traces: [],
            delivery_statuses: [],
            summary: {
                total_events: 0,
                total_rules_matched: 0,
                total_rules_skipped: 0,
                total_emails_sent: 0,
                total_delivered: 0,
                total_bounced: 0,
                total_pending: 0
            }
        };

        // Step 1: Find events for this record
        result.events = this._findEvents(tableName, sysId);
        result.summary.total_events = result.events.length;

        // Step 2: Match rules against each event
        var ruleMatches = this._matchRules(result.events);
        result.rule_matches = ruleMatches;

        for (var i = 0; i < ruleMatches.length; i++) {
            if (ruleMatches[i].matched) {
                result.summary.total_rules_matched++;
            } else {
                result.summary.total_rules_skipped++;
            }
        }

        // Step 3: Trace email actions for matched rules
        var matchedRules = [];
        for (var j = 0; j < ruleMatches.length; j++) {
            if (ruleMatches[j].matched) {
                matchedRules.push(ruleMatches[j].rule);
            }
        }
        result.email_traces = this._traceEmailActions(matchedRules, sysId);
        result.summary.total_emails_sent = result.email_traces.length;

        // Step 4: Check delivery status for each email
        result.delivery_statuses = this._checkDelivery(result.email_traces);

        for (var k = 0; k < result.delivery_statuses.length; k++) {
            var ds = result.delivery_statuses[k];
            if (ds.state === 'delivered') {
                result.summary.total_delivered++;
            } else if (ds.state === 'bounced' || ds.state === 'failed') {
                result.summary.total_bounced++;
            } else {
                result.summary.total_pending++;
            }
        }

        this._traceResult = result;
        return result;
    },

    /**
     * Find all sysevent records for a given table + document key.
     * @private
     */
    _findEvents: function(tableName, sysId) {
        var events = [];
        var grEvent = new GlideRecord('sysevent');
        grEvent.addQuery('table', tableName);
        grEvent.addQuery('instance', sysId);
        grEvent.orderBy('sys_created_on');
        grEvent.query();

        while (grEvent.next()) {
            events.push({
                sys_id: grEvent.getValue('sys_id'),
                name: grEvent.getValue('name'),
                table: grEvent.getValue('table'),
                instance: grEvent.getValue('instance'),
                state: grEvent.getValue('state'),
                queue: grEvent.getValue('queue'),
                created_on: grEvent.getValue('sys_created_on'),
                processed_on: grEvent.getValue('processed'),
                parm1: grEvent.getValue('parm1'),
                parm2: grEvent.getValue('parm2')
            });
        }
        return events;
    },

    /**
     * Match event rules against a list of events.
     * Returns both matched and skipped rules with reasons.
     * @private
     */
    _matchRules: function(events) {
        var ruleMatches = [];
        var seenRuleIds = {};

        for (var i = 0; i < events.length; i++) {
            var evt = events[i];
            var grRule = new GlideRecord('sysevent_rule');
            grRule.addQuery('event_name', evt.name);
            grRule.addQuery('table', evt.table);
            grRule.addQuery('active', true);
            grRule.orderBy('order');
            grRule.query();

            while (grRule.next()) {
                var ruleSysId = grRule.getValue('sys_id');

                // Skip if we already processed this rule for a prior event
                if (seenRuleIds[ruleSysId]) {
                    continue;
                }
                seenRuleIds[ruleSysId] = true;

                var ruleData = {
                    sys_id: ruleSysId,
                    name: grRule.getValue('name'),
                    event_name: grRule.getValue('event_name'),
                    table: grRule.getValue('table'),
                    order: parseInt(grRule.getValue('order'), 10) || 0,
                    condition: grRule.getValue('condition') || '',
                    script: grRule.getValue('script') || '',
                    active: grRule.getValue('active') === 'true' || grRule.getValue('active') === true,
                    description: grRule.getValue('description') || ''
                };

                // Evaluate condition
                var conditionResult = this._evaluateCondition(ruleData.condition, evt);

                ruleMatches.push({
                    rule: ruleData,
                    event: evt,
                    matched: conditionResult.matched,
                    reason: conditionResult.reason
                });
            }
        }
        return ruleMatches;
    },

    /**
     * Evaluate a rule condition against an event.
     * Handles common condition patterns: field=value, field!=value, fieldSTARTSWITHvalue, etc.
     * @private
     */
    _evaluateCondition: function(condition, event) {
        if (!condition || condition === '') {
            return { matched: true, reason: '' };
        }

        // Simple condition parsing: split on ^ (AND) and evaluate each clause
        var clauses = condition.split('^');
        for (var i = 0; i < clauses.length; i++) {
            var clause = clauses[i].trim();
            if (clause === '') {
                continue;
            }

            // Parse: fieldOPERATORvalue
            var parsed = this._parseConditionClause(clause);
            if (!parsed) {
                return { matched: false, reason: 'Unparseable condition: ' + clause };
            }

            // Evaluate against event parameters
            var eventValue = this._getEventParam(event, parsed.field);
            var clauseResult = this._evaluateClause(eventValue, parsed.operator, parsed.value);

            if (!clauseResult) {
                return { matched: false, reason: 'Condition not met: ' + clause + ' (event value: ' + eventValue + ')' };
            }
        }

        return { matched: true, reason: '' };
    },

    /**
     * Parse a condition clause like "state=ready" or "priority>=2".
     * @private
     */
    _parseConditionClause: function(clause) {
        var operators = ['!=', '>=', '<=', '=', '>', '<', 'STARTSWITH', 'ENDSWITH', 'CONTAINS', 'NOT IN', 'IN'];
        for (var i = 0; i < operators.length; i++) {
            var op = operators[i];
            var idx = clause.indexOf(op);
            if (idx > 0) {
                return {
                    field: clause.substring(0, idx).trim(),
                    operator: op,
                    value: clause.substring(idx + op.length).trim()
                };
            }
        }
        return null;
    },

    /**
     * Get a parameter value from an event record.
     * @private
     */
    _getEventParam: function(event, field) {
        if (field === 'state') return event.state || '';
        if (field === 'queue') return event.queue || '';
        if (field === 'name') return event.name || '';
        if (field === 'table') return event.table || '';
        if (field === 'parm1') return event.parm1 || '';
        if (field === 'parm2') return event.parm2 || '';
        return '';
    },

    /**
     * Evaluate a single condition clause.
     * @private
     */
    _evaluateClause: function(eventValue, operator, conditionValue) {
        var ev = (eventValue || '').toString();
        var cv = (conditionValue || '').toString();

        switch (operator) {
            case '=':
                return ev === cv;
            case '!=':
                return ev !== cv;
            case '>':
                return parseFloat(ev) > parseFloat(cv);
            case '<':
                return parseFloat(ev) < parseFloat(cv);
            case '>=':
                return parseFloat(ev) >= parseFloat(cv);
            case '<=':
                return parseFloat(ev) <= parseFloat(cv);
            case 'STARTSWITH':
                return ev.indexOf(cv) === 0;
            case 'ENDSWITH':
                return ev.lastIndexOf(cv) === ev.length - cv.length && ev.length >= cv.length;
            case 'CONTAINS':
                return ev.indexOf(cv) !== -1;
            case 'IN':
                var values = cv.split(',');
                for (var i = 0; i < values.length; i++) {
                    if (ev === values[i].trim()) return true;
                }
                return false;
            case 'NOT IN':
                var nv = cv.split(',');
                for (var j = 0; j < nv.length; j++) {
                    if (ev === nv[j].trim()) return false;
                }
                return true;
            default:
                return ev === cv;
        }
    },

    /**
     * Trace email actions for matched rules.
     * @private
     */
    _traceEmailActions: function(matchedRules, recordSysId) {
        var emailTraces = [];

        for (var i = 0; i < matchedRules.length; i++) {
            var rule = matchedRules[i];
            var grAction = new GlideRecord('sysevent_email_action');
            grAction.addQuery('event_name', rule.event_name);
            grAction.addQuery('active', true);
            grAction.query();

            while (grAction.next()) {
                var actionSysId = grAction.getValue('sys_id');

                // Find the sys_email record for this action + record
                var grEmail = new GlideRecord('sys_email');
                grEmail.addQuery('instance', recordSysId);
                grEmail.addQuery('type', 'send-ready');
                grEmail.addOrCondition('type', 'sent');
                grEmail.addOrCondition('type', 'failed');
                grEmail.orderByDesc('sys_created_on');
                grEmail.setLimit(10);
                grEmail.query();

                while (grEmail.next()) {
                    emailTraces.push({
                        action: {
                            sys_id: actionSysId,
                            name: grAction.getValue('name'),
                            event_name: grAction.getValue('event_name'),
                            template: grAction.getValue('email_style') || '',
                            recipient: grAction.getValue('recipient') || ''
                        },
                        email: {
                            sys_id: grEmail.getValue('sys_id'),
                            subject: grEmail.getValue('subject') || '',
                            type: grEmail.getValue('type'),
                            state: grEmail.getValue('state') || '',
                            created_on: grEmail.getValue('sys_created_on'),
                            recipient: grEmail.getValue('recipients') || grEmail.getValue('direct') || ''
                        },
                        rule: rule
                    });
                }
            }
        }
        return emailTraces;
    },

    /**
     * Check delivery status for each email trace.
     * @private
     */
    _checkDelivery: function(emailTraces) {
        var deliveryStatuses = [];

        for (var i = 0; i < emailTraces.length; i++) {
            var trace = emailTraces[i];
            var emailSysId = trace.email.sys_id;

            var grLog = new GlideRecord('sys_email_log');
            grLog.addQuery('email', emailSysId);
            grLog.orderByDesc('sys_created_on');
            grLog.setLimit(5);
            grLog.query();

            var state = 'pending';
            var detail = 'No delivery log entries found';
            var logEntries = [];
            var stateSet = false;

            while (grLog.next()) {
                var logType = grLog.getValue('type') || '';
                logEntries.push({
                    type: logType,
                    created_on: grLog.getValue('sys_created_on'),
                    detail: grLog.getValue('detail') || ''
                });

                if (!stateSet) {
                    if (logType === 'delivered' || logType === 'open') {
                        state = 'delivered';
                        detail = 'Delivered at ' + grLog.getValue('sys_created_on');
                        stateSet = true;
                    } else if (logType === 'bounce' || logType === 'failed') {
                        state = 'bounced';
                        detail = grLog.getValue('detail') || 'Bounce recorded';
                        stateSet = true;
                    }
                }
            }

            if (trace.email.type === 'failed') {
                state = 'failed';
                detail = 'Email send failed';
            } else if (trace.email.type === 'send-ready' && logEntries.length === 0) {
                state = 'stuck';
                detail = 'Email stuck in outbox (send-ready, no log entries)';
            }

            deliveryStatuses.push({
                email_sys_id: emailSysId,
                email_subject: trace.email.subject,
                state: state,
                detail: detail,
                log_entries: logEntries
            });
        }
        return deliveryStatuses;
    },

    /**
     * Detect silent failures across the notification system.
     * @param {number} daysBack — how many days to look back (default: 1)
     * @return {object} FailureReport
     */
    detectSilentFailures: function(daysBack) {
        daysBack = daysBack || 1;
        var report = {
            stuck_emails: this._scanOutbox(daysBack),
            dead_rules: this._findDeadRules(30),
            orphan_actions: this._findOrphanActions(),
            account_health: this._checkAccounts(),
            generated_at: new GlideDateTime().getDisplayValue()
        };
        return report;
    },

    /**
     * Scan outbox for stuck emails.
     * @private
     */
    _scanOutbox: function(daysBack) {
        var stuck = [];
        var cutoff = new GlideDateTime();
        cutoff.addSeconds(-daysBack * 86400);

        var grEmail = new GlideRecord('sys_email');
        grEmail.addQuery('type', 'send-ready');
        grEmail.addQuery('sys_created_on', '<=', cutoff.getDisplayValue());
        grEmail.setLimit(100);
        grEmail.query();

        while (grEmail.next()) {
            stuck.push({
                sys_id: grEmail.getValue('sys_id'),
                subject: grEmail.getValue('subject') || '',
                created_on: grEmail.getValue('sys_created_on'),
                recipient: grEmail.getValue('recipients') || '',
                instance: grEmail.getValue('instance') || ''
            });
        }
        return stuck;
    },

    /**
     * Find event rules that haven't fired in N days.
     * @private
     */
    _findDeadRules: function(daysThreshold) {
        var dead = [];
        var cutoff = new GlideDateTime();
        cutoff.addSeconds(-daysThreshold * 86400);

        var grRule = new GlideRecord('sysevent_rule');
        grRule.addQuery('active', true);
        grRule.query();

        while (grRule.next()) {
            var ruleSysId = grRule.getValue('sys_id');
            var ruleName = grRule.getValue('name');

            // Check if any sysevent was processed for this rule recently
            var grEvent = new GlideRecord('sysevent');
            grEvent.addQuery('name', grRule.getValue('event_name'));
            grEvent.addQuery('sys_created_on', '>=', cutoff.getDisplayValue());
            grEvent.setLimit(1);
            grEvent.query();

            if (!grEvent.next()) {
                dead.push({
                    sys_id: ruleSysId,
                    name: ruleName,
                    event_name: grRule.getValue('event_name'),
                    table: grRule.getValue('table'),
                    last_modified: grRule.getValue('sys_updated_on') || ''
                });
            }
        }
        return dead;
    },

    /**
     * Find email actions referencing deleted/retired templates.
     * @private
     */
    _findOrphanActions: function() {
        var orphans = [];
        var grAction = new GlideRecord('sysevent_email_action');
        grAction.addQuery('active', true);
        grAction.query();

        while (grAction.next()) {
            var styleId = grAction.getValue('email_style') || '';
            if (styleId === '') {
                continue;
            }

            var grStyle = new GlideRecord('sysevent_email_style');
            if (!grStyle.get(styleId)) {
                orphans.push({
                    sys_id: grAction.getValue('sys_id'),
                    name: grAction.getValue('name'),
                    event_name: grAction.getValue('event_name'),
                    missing_template_id: styleId
                });
            }
        }
        return orphans;
    },

    /**
     * Check email account health.
     * @private
     */
    _checkAccounts: function() {
        var accounts = [];
        var grAccount = new GlideRecord('sys_email_account');
        grAccount.addQuery('active', true);
        grAccount.query();

        while (grAccount.next()) {
            var accType = grAccount.getValue('type') || '';
            var accName = grAccount.getValue('name') || '';

            // Check for recent send failures for this specific account
            var grEmail = new GlideRecord('sys_email');
            grEmail.addQuery('type', 'failed');
            grEmail.addQuery('email_account', grAccount.getValue('sys_id'));
            grEmail.addQuery('sys_created_on', '>=', (function() {
                var d = new GlideDateTime();
                d.addSeconds(-86400);
                return d.getDisplayValue();
            })());
            grEmail.setLimit(1);
            grEmail.query();

            accounts.push({
                sys_id: grAccount.getValue('sys_id'),
                name: accName,
                type: accType,
                active: true,
                recent_failures: grEmail.hasNext()
            });
        }
        return accounts;
    },

    /**
     * Execute a remediation action.
     * @param {string} action — 'deactivate_rule', 'resend_email', 'clone_and_fix'
     * @param {object} target — { rule_sys_id, email_sys_id, fix_params }
     * @return {object} RemediationResult
     */
    remediate: function(action, target) {
        var result = { action: action, success: false, message: '', details: {} };

        try {
            switch (action) {
                case 'deactivate_rule':
                    result = this._deactivateRule(target.rule_sys_id);
                    break;
                case 'resend_email':
                    result = this._resendEmail(target.email_sys_id);
                    break;
                case 'clone_and_fix':
                    result = this._cloneAndFix(target.rule_sys_id, target.fix_params);
                    break;
                default:
                    result.message = 'Unknown remediation action: ' + action;
            }
        } catch (e) {
            result.success = false;
            result.message = 'Remediation failed: ' + e.toString();
        }

        // Log remediation to trace_result
        this._logRemediation(action, target, result);

        return result;
    },

    /**
     * Deactivate an event rule.
     * @private
     */
    _deactivateRule: function(ruleSysId) {
        var gr = new GlideRecord('sysevent_rule');
        if (!gr.get(ruleSysId)) {
            return { action: 'deactivate_rule', success: false, message: 'Rule not found: ' + ruleSysId };
        }
        gr.setValue('active', false);
        try {
            gr.update();
            return { action: 'deactivate_rule', success: true, message: 'Rule deactivated', details: { rule_sys_id: ruleSysId } };
        } catch (e) {
            return { action: 'deactivate_rule', success: false, message: 'Update failed: ' + e.toString() };
        }
    },

    /**
     * Re-send a stuck/failed email.
     * @private
     */
    _resendEmail: function(emailSysId) {
        var gr = new GlideRecord('sys_email');
        if (!gr.get(emailSysId)) {
            return { action: 'resend_email', success: false, message: 'Email not found: ' + emailSysId };
        }
        gr.setValue('type', 'send-ready');
        try {
            gr.update();
            return { action: 'resend_email', success: true, message: 'Email re-queued for sending', details: { email_sys_id: emailSysId } };
        } catch (e) {
            return { action: 'resend_email', success: false, message: 'Re-queue failed: ' + e.toString() };
        }
    },

    /**
     * Clone a rule and apply fixes.
     * @private
     */
    _cloneAndFix: function(ruleSysId, fixParams) {
        var grSource = new GlideRecord('sysevent_rule');
        if (!grSource.get(ruleSysId)) {
            return { action: 'clone_and_fix', success: false, message: 'Source rule not found: ' + ruleSysId };
        }

        var grNew = new GlideRecord('sysevent_rule');
        grNew.initialize();
        grNew.setValue('name', (grSource.getValue('name') || '') + ' (Fixed)');
        grNew.setValue('event_name', grSource.getValue('event_name'));
        grNew.setValue('table', grSource.getValue('table'));
        grNew.setValue('order', parseInt(grSource.getValue('order'), 10) + 1);
        grNew.setValue('active', true);
        grNew.setValue('email_style', grSource.getValue('email_style'));
        grNew.setValue('description', grSource.getValue('description'));

        if (fixParams && fixParams.condition) {
            grNew.setValue('condition', fixParams.condition);
        } else {
            grNew.setValue('condition', grSource.getValue('condition'));
        }

        if (fixParams && fixParams.script) {
            grNew.setValue('script', fixParams.script);
        } else {
            grNew.setValue('script', grSource.getValue('script'));
        }

        try {
            var newSysId = grNew.insert();
            return {
                action: 'clone_and_fix',
                success: true,
                message: 'Rule cloned and fixed',
                details: { original_sys_id: ruleSysId, new_sys_id: newSysId }
            };
        } catch (e) {
            return { action: 'clone_and_fix', success: false, message: 'Clone failed: ' + e.toString() };
        }
    },

    /**
     * Log a remediation action to x_ntrc_trace_result.
     * @private
     */
    _logRemediation: function(action, target, result) {
        try {
            var gr = new GlideRecord('x_ntrc_trace_result');
            gr.initialize();
            gr.setValue('source_table', 'sysevent_rule');
            gr.setValue('source_sys_id', target.rule_sys_id || target.email_sys_id || '');
            gr.setValue('trace_type', 'health');
            gr.setValue('remediation_json', JSON.stringify({
                action: action,
                target: target,
                result: result
            }));
            gr.setValue('executed_at', new GlideDateTime().getDisplayValue());
            gr.insert();
        } catch (e) {
            gs.error('NotificationTracer: Failed to log remediation: ' + e.toString());
        }
    },

    /**
     * Store a trace result in the database.
     * @param {object} traceResult — from traceRecord()
     * @param {string} traceType — 'record', 'health', or 'overlap'
     * @return {string} sys_id of the created record
     */
    storeTraceResult: function(traceResult, traceType, timelineJson) {
        try {
            var gr = new GlideRecord('x_ntrc_trace_result');
            gr.initialize();
            gr.setValue('source_table', traceResult.source.table);
            gr.setValue('source_sys_id', traceResult.source.sys_id);
            gr.setValue('trace_type', traceType || 'record');
            gr.setValue('trace_json', JSON.stringify(traceResult));
            gr.setValue('timeline_json', timelineJson ? JSON.stringify(timelineJson) : '');
            gr.setValue('health_score', traceResult.summary ? this._computeHealthScore(traceResult.summary) : 0);
            gr.setValue('failure_count', traceResult.summary ? traceResult.summary.total_bounced : 0);
            gr.setValue('executed_at', new GlideDateTime().getDisplayValue());
            return gr.insert();
        } catch (e) {
            gs.error('NotificationTracer: Failed to store trace result: ' + e.toString());
            return null;
        }
    },

    /**
     * Compute a simple health score from trace summary.
     * @private
     */
    _computeHealthScore: function(summary) {
        var total = summary.total_emails_sent || 0;
        if (total === 0) return 100;
        var failed = (summary.total_bounced || 0) + (summary.total_pending || 0);
        var score = Math.round(100 - (failed / total * 100));
        return Math.max(0, Math.min(100, score));
    },

    type: 'NotificationTracer'
};