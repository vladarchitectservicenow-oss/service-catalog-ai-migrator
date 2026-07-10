// Notification Trace — TraceAnalyzer (Analysis Engine)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Analysis engine: overlap detection, health computation, timeline generation, AI explanation.
// All computation/aggregation logic lives here; read/write operations are in NotificationTracer.
// @class TraceAnalyzer @namespace x_ntrc

var TraceAnalyzer = Class.create();
TraceAnalyzer.prototype = {

    initialize: function() {
        this._tracer = new NotificationTracer();
    },

    /**
     * Detect overlapping event rules across the instance.
     * Groups rules by (table, event_name), then compares conditions pairwise.
     * @return {object[]} OverlapPair[] sorted by risk_score DESC
     */
    detectOverlaps: function() {
        var overlaps = [];
        var groups = this._groupRulesByTableAndEvent();

        var groupKeys = Object.keys(groups);
        for (var g = 0; g < groupKeys.length; g++) {
            var rules = groups[groupKeys[g]];
            if (rules.length < 2) {
                continue;
            }

            // Compare each pair within the group
            for (var i = 0; i < rules.length; i++) {
                for (var j = i + 1; j < rules.length; j++) {
                    var ruleA = rules[i];
                    var ruleB = rules[j];

                    var overlap = this._compareRulePair(ruleA, ruleB);
                    if (overlap && overlap.risk_score >= 30) {
                        overlaps.push(overlap);
                    }
                }
            }
        }

        // Sort by risk_score descending
        overlaps.sort(function(a, b) {
            return b.risk_score - a.risk_score;
        });

        return overlaps;
    },

    /**
     * Group all active event rules by (table, event_name).
     * @private
     */
    _groupRulesByTableAndEvent: function() {
        var groups = {};
        var gr = new GlideRecord('sysevent_rule');
        gr.addQuery('active', true);
        gr.query();

        while (gr.next()) {
            var table = gr.getValue('table') || '';
            var eventName = gr.getValue('event_name') || '';
            var key = table + '::' + eventName;

            if (!groups[key]) {
                groups[key] = [];
            }

            groups[key].push({
                sys_id: gr.getValue('sys_id'),
                name: gr.getValue('name') || '',
                table: table,
                event_name: eventName,
                order: parseInt(gr.getValue('order'), 10) || 0,
                condition: gr.getValue('condition') || '',
                script: gr.getValue('script') || '',
                email_style: gr.getValue('email_style') || '',
                sys_updated_on: gr.getValue('sys_updated_on') || ''
            });
        }
        return groups;
    },

    /**
     * Compare two rules and determine overlap type + risk score.
     * @private
     */
    _compareRulePair: function(ruleA, ruleB) {
        var condA = ruleA.condition || '';
        var condB = ruleB.condition || '';

        var overlapType = 'NO_OVERLAP';
        var baseRisk = 0;

        if (condA === condB && condA !== '') {
            // Identical conditions
            overlapType = 'DUPLICATE';
            baseRisk = 95;
        } else if (condA === '' && condB === '') {
            // Both have no conditions — both fire for every event
            overlapType = 'DUPLICATE';
            baseRisk = 90;
        } else if (condA === '' && condB !== '') {
            // A fires for everything, B is a subset
            overlapType = 'REDUNDANT';
            baseRisk = 80;
        } else if (condB === '' && condA !== '') {
            overlapType = 'REDUNDANT';
            baseRisk = 80;
        } else if (this._isConditionSubset(condA, condB)) {
            overlapType = 'REDUNDANT';
            baseRisk = 80;
        } else if (this._isConditionSubset(condB, condA)) {
            overlapType = 'REDUNDANT';
            baseRisk = 80;
        } else if (this._conditionsOverlap(condA, condB)) {
            overlapType = 'PARTIAL_OVERLAP';
            baseRisk = 50;
        }

        if (overlapType === 'NO_OVERLAP') {
            return null;
        }

        // Delivery penalty: same email template
        var deliveryPenalty = 0;
        if (ruleA.email_style && ruleB.email_style && ruleA.email_style === ruleB.email_style) {
            deliveryPenalty = 20;
        }

        // Age factor: rules not modified in 365+ days
        var ageFactor = 0;
        var oneYearAgo = new GlideDateTime();
        oneYearAgo.addSeconds(-365 * 86400);
        if (ruleA.sys_updated_on && ruleA.sys_updated_on < oneYearAgo.getDisplayValue()) {
            ageFactor += 10;
        }
        if (ruleB.sys_updated_on && ruleB.sys_updated_on < oneYearAgo.getDisplayValue()) {
            ageFactor += 10;
        }

        var riskScore = Math.min(100, baseRisk + deliveryPenalty + ageFactor);

        return {
            rule_a: ruleA,
            rule_b: ruleB,
            overlap_type: overlapType,
            risk_score: riskScore,
            table: ruleA.table,
            event_name: ruleA.event_name
        };
    },

    /**
     * Check if condA is a subset of condB (A's conditions are fully covered by B).
     * Simple implementation: check if all clauses in condA appear in condB.
     * @private
     */
    _isConditionSubset: function(condA, condB) {
        if (!condA || condA === '') return false;
        if (!condB || condB === '') return true;

        var clausesA = condA.split('^');
        for (var i = 0; i < clausesA.length; i++) {
            var clause = clausesA[i].trim();
            if (clause === '') continue;
            if (condB.indexOf(clause) === -1) {
                return false;
            }
        }
        return true;
    },

    /**
     * Check if two conditions have any overlap (share at least one clause).
     * @private
     */
    _conditionsOverlap: function(condA, condB) {
        if (!condA || !condB) return false;
        var clausesA = condA.split('^');
        for (var i = 0; i < clausesA.length; i++) {
            var clause = clausesA[i].trim();
            if (clause === '') continue;
            if (condB.indexOf(clause) !== -1) {
                return true;
            }
        }
        return false;
    },

    /**
     * Compute a comprehensive health snapshot of the notification system.
     * @return {object} HealthSnapshot
     */
    computeHealth: function() {
        var snapshot = {
            generated_at: new GlideDateTime().getDisplayValue(),
            rule_stats: this._computeRuleStats(),
            delivery_stats: this._computeDeliveryStats(),
            latency_stats: this._computeLatencyStats(),
            trend_comparison: this._computeTrendComparison()
        };

        // Compute overall health score (0-100)
        snapshot.health_score = this._calculateOverallHealth(snapshot);

        return snapshot;
    },

    /**
     * Compute rule statistics.
     * @private
     */
    _computeRuleStats: function() {
        var stats = { total: 0, active: 0, inactive: 0, dead: 0, overlapping: 0 };

        var gr = new GlideRecord('sysevent_rule');
        gr.query();
        stats.total = gr.getRowCount();

        var grActive = new GlideRecord('sysevent_rule');
        grActive.addQuery('active', true);
        grActive.query();
        stats.active = grActive.getRowCount();
        stats.inactive = stats.total - stats.active;

        // Dead rules: active but no executions in 30 days
        var cutoff = new GlideDateTime();
        cutoff.addSeconds(-30 * 86400);
        var grDead = new GlideRecord('sysevent_rule');
        grDead.addQuery('active', true);
        grDead.query();
        while (grDead.next()) {
            var grEvent = new GlideRecord('sysevent');
            grEvent.addQuery('name', grDead.getValue('event_name'));
            grEvent.addQuery('sys_created_on', '>=', cutoff.getDisplayValue());
            grEvent.setLimit(1);
            grEvent.query();
            if (!grEvent.hasNext()) {
                stats.dead++;
            }
        }

        // Overlapping rules
        var overlaps = this.detectOverlaps();
        stats.overlapping = overlaps.length;

        return stats;
    },

    /**
     * Compute delivery statistics from sys_email.
     * @private
     */
    _computeDeliveryStats: function() {
        var stats = { sent: 0, delivered: 0, bounced: 0, stuck: 0, failed: 0 };

        var gr = new GlideRecord('sys_email');
        gr.query();
        stats.sent = gr.getRowCount();

        var grDelivered = new GlideRecord('sys_email');
        grDelivered.addQuery('type', 'sent');
        grDelivered.query();
        stats.delivered = grDelivered.getRowCount();

        var grBounced = new GlideRecord('sys_email');
        grBounced.addQuery('type', 'failed');
        grBounced.query();
        stats.bounced = grBounced.getRowCount();

        var grStuck = new GlideRecord('sys_email');
        grStuck.addQuery('type', 'send-ready');
        grStuck.query();
        stats.stuck = grStuck.getRowCount();

        stats.failed = stats.bounced + stats.stuck;

        return stats;
    },

    /**
     * Compute latency statistics from sys_email_log.
     * @private
     */
    _computeLatencyStats: function() {
        // Latency is computed as the difference between sys_email.sys_created_on
        // and the first 'delivered' log entry. For a production implementation,
        // this would use GlideAggregate. Here we provide a representative sample.
        var stats = { avg_ms: 0, p50_ms: 0, p95_ms: 0, p99_ms: 0, sample_size: 0 };

        var latencies = [];
        var grEmail = new GlideRecord('sys_email');
        grEmail.addQuery('type', 'sent');
        grEmail.setLimit(100);
        grEmail.orderByDesc('sys_created_on');
        grEmail.query();

        while (grEmail.next()) {
            var createdOn = new GlideDateTime(grEmail.getValue('sys_created_on'));

            var grLog = new GlideRecord('sys_email_log');
            grLog.addQuery('email', grEmail.getValue('sys_id'));
            grLog.addQuery('type', 'delivered');
            grLog.orderBy('sys_created_on');
            grLog.setLimit(1);
            grLog.query();

            if (grLog.next()) {
                var deliveredOn = new GlideDateTime(grLog.getValue('sys_created_on'));
                var diff = GlideDateTime.subtract(deliveredOn, createdOn);
                var ms = diff.getNumericValue();
                latencies.push(ms);
            }
        }

        if (latencies.length > 0) {
            latencies.sort(function(a, b) { return a - b; });
            stats.sample_size = latencies.length;
            stats.avg_ms = Math.round(latencies.reduce(function(sum, v) { return sum + v; }, 0) / latencies.length);
            stats.p50_ms = latencies[Math.floor(latencies.length * 0.5)];
            stats.p95_ms = latencies[Math.floor(latencies.length * 0.95)];
            stats.p99_ms = latencies[Math.floor(latencies.length * 0.99)];
        }

        return stats;
    },

    /**
     * Compare current metrics against 7-day and 30-day trends.
     * @private
     */
    _computeTrendComparison: function() {
        var trend = { vs_7d: {}, vs_30d: {} };

        // Compare current stuck count vs 7 days ago
        var now = new GlideDateTime();
        var sevenDaysAgo = new GlideDateTime();
        sevenDaysAgo.addSeconds(-7 * 86400);

        var grCurrent = new GlideRecord('sys_email');
        grCurrent.addQuery('type', 'send-ready');
        grCurrent.query();
        var currentStuck = grCurrent.getRowCount();

        var grPast = new GlideRecord('sys_email');
        // Count currently-stuck emails that were created more than 7 days ago.
        // The type='send-ready' filter ensures we only count emails still stuck now,
        // not ones that were stuck 7 days ago but have since been resolved.
        grPast.addQuery('type', 'send-ready');
        grPast.addQuery('sys_created_on', '<=', sevenDaysAgo.getDisplayValue());
        grPast.query();
        var pastStuck = grPast.getRowCount();

        trend.vs_7d = {
            stuck_emails: { current: currentStuck, previous: pastStuck, delta: currentStuck - pastStuck }
        };

        // 30-day comparison
        var thirtyDaysAgo = new GlideDateTime();
        thirtyDaysAgo.addSeconds(-30 * 86400);

        var grPast30 = new GlideRecord('sys_email');
        grPast30.addQuery('type', 'send-ready');
        grPast30.addQuery('sys_created_on', '<=', thirtyDaysAgo.getDisplayValue());
        grPast30.query();
        var past30Stuck = grPast30.getRowCount();

        trend.vs_30d = {
            stuck_emails: { current: currentStuck, previous: past30Stuck, delta: currentStuck - past30Stuck }
        };

        return trend;
    },

    /**
     * Calculate overall health score (0-100).
     * @private
     */
    _calculateOverallHealth: function(snapshot) {
        var score = 100;

        // Penalty for dead rules (>20 = -10, >50 = -20)
        if (snapshot.rule_stats.dead > 50) {
            score -= 20;
        } else if (snapshot.rule_stats.dead > 20) {
            score -= 10;
        }

        // Penalty for overlapping rules (>5 = -10, >10 = -20)
        if (snapshot.rule_stats.overlapping > 10) {
            score -= 20;
        } else if (snapshot.rule_stats.overlapping > 5) {
            score -= 10;
        }

        // Penalty for stuck emails (>10 = -15, >50 = -30)
        if (snapshot.delivery_stats.stuck > 50) {
            score -= 30;
        } else if (snapshot.delivery_stats.stuck > 10) {
            score -= 15;
        }

        // Penalty for high failure rate (>5% = -15, >10% = -25)
        if (snapshot.delivery_stats.sent > 0) {
            var failureRate = snapshot.delivery_stats.failed / snapshot.delivery_stats.sent * 100;
            if (failureRate > 10) {
                score -= 25;
            } else if (failureRate > 5) {
                score -= 15;
            }
        }

        return Math.max(0, Math.min(100, score));
    },

    /**
     * Generate a swimlane timeline from a trace result.
     * @param {object} traceResult — from NotificationTracer.traceRecord()
     * @return {object} TimelineJSON with swimlane structure
     */
    generateTimeline: function(traceResult) {
        var timeline = {
            source: traceResult.source,
            generated_at: new GlideDateTime().getDisplayValue(),
            swimlanes: [
                { name: 'Events', entries: [] },
                { name: 'Rules', entries: [] },
                { name: 'Email Actions', entries: [] },
                { name: 'Delivery', entries: [] }
            ]
        };

        // Events swimlane
        for (var i = 0; i < traceResult.events.length; i++) {
            var evt = traceResult.events[i];
            timeline.swimlanes[0].entries.push({
                id: evt.sys_id,
                label: evt.name,
                timestamp: evt.created_on,
                state: evt.state === 'processed' ? 'green' : 'yellow',
                detail: 'Queue: ' + (evt.queue || 'default') + ', State: ' + evt.state
            });
        }

        // Rules swimlane
        for (var j = 0; j < traceResult.rule_matches.length; j++) {
            var rm = traceResult.rule_matches[j];
            timeline.swimlanes[1].entries.push({
                id: rm.rule.sys_id,
                label: rm.rule.name,
                timestamp: rm.event.created_on,
                state: rm.matched ? 'green' : 'gray',
                detail: rm.matched ? 'Matched (order ' + rm.rule.order + ')' : 'Skipped: ' + rm.reason
            });
        }

        // Email Actions swimlane
        for (var k = 0; k < traceResult.email_traces.length; k++) {
            var et = traceResult.email_traces[k];
            timeline.swimlanes[2].entries.push({
                id: et.action.sys_id,
                label: et.action.name,
                timestamp: et.email.created_on,
                state: et.email.type === 'sent' ? 'green' : (et.email.type === 'failed' ? 'red' : 'yellow'),
                detail: 'Subject: ' + et.email.subject + ', Type: ' + et.email.type
            });
        }

        // Delivery swimlane
        for (var m = 0; m < traceResult.delivery_statuses.length; m++) {
            var ds = traceResult.delivery_statuses[m];
            var stateColor = 'yellow';
            if (ds.state === 'delivered') stateColor = 'green';
            else if (ds.state === 'bounced' || ds.state === 'failed') stateColor = 'red';
            else if (ds.state === 'stuck') stateColor = 'red';

            timeline.swimlanes[3].entries.push({
                id: ds.email_sys_id,
                label: ds.email_subject,
                timestamp: ds.log_entries.length > 0 ? ds.log_entries[0].created_on : '',
                state: stateColor,
                detail: ds.state + ': ' + ds.detail
            });
        }

        return timeline;
    },

    /**
     * Generate an AI-powered root cause explanation.
     * Calls Now Assist API with structured trace data + user question.
     * @param {object} traceResult — from NotificationTracer.traceRecord()
     * @param {string} userQuestion — natural language question
     * @return {object} AIExplanation
     */
    aiExplain: function(traceResult, userQuestion) {
        var explanation = {
            summary: '',
            root_cause: '',
            suggested_fix: '',
            confidence: 0,
            generated_at: new GlideDateTime().getDisplayValue()
        };

        // Build a structured prompt for Now Assist
        var prompt = this._buildAIPrompt(traceResult, userQuestion);

        try {
            // Call Now Assist API
            var aiResponse = this._callNowAssist(prompt);

            if (aiResponse && aiResponse.success) {
                explanation.summary = aiResponse.summary || '';
                explanation.root_cause = aiResponse.root_cause || '';
                explanation.suggested_fix = aiResponse.suggested_fix || '';
                explanation.confidence = aiResponse.confidence || 0;
            } else {
                // Fallback: rule-based explanation
                explanation = this._ruleBasedExplanation(traceResult, userQuestion);
                explanation.confidence = 50;
            }
        } catch (e) {
            gs.warn('TraceAnalyzer: Now Assist call failed, using rule-based fallback: ' + e.toString());
            explanation = this._ruleBasedExplanation(traceResult, userQuestion);
            explanation.confidence = 40;
        }

        return explanation;
    },

    /**
     * Build a prompt for the Now Assist API.
     * @private
     */
    _buildAIPrompt: function(traceResult, userQuestion) {
        var prompt = 'You are a ServiceNow notification expert. Here is the notification trace:\n\n';

        prompt += 'Source: ' + traceResult.source.table + ' (' + traceResult.source.sys_id + ')\n';
        prompt += 'Events emitted: ' + traceResult.summary.total_events + '\n';
        prompt += 'Rules matched: ' + traceResult.summary.total_rules_matched + '\n';
        prompt += 'Rules skipped: ' + traceResult.summary.total_rules_skipped + '\n';
        prompt += 'Emails sent: ' + traceResult.summary.total_emails_sent + '\n';
        prompt += 'Delivered: ' + traceResult.summary.total_delivered + '\n';
        prompt += 'Bounced/Failed: ' + traceResult.summary.total_bounced + '\n';
        prompt += 'Pending: ' + traceResult.summary.total_pending + '\n\n';

        // Add delivery details
        for (var i = 0; i < traceResult.delivery_statuses.length; i++) {
            var ds = traceResult.delivery_statuses[i];
            prompt += 'Email: ' + ds.email_subject + ' — State: ' + ds.state + ' — ' + ds.detail + '\n';
        }

        prompt += '\nUser question: ' + userQuestion + '\n';
        prompt += '\nExplain the root cause in 2-3 sentences and suggest a fix.';

        return prompt;
    },

    /**
     * Call the Now Assist API.
     * @private
     */
    _callNowAssist: function(prompt) {
        try {
            var rm = new sn_ws.RESTMessageV2();
            rm.setEndpoint('/api/sn_now_assist/ask');
            rm.setHttpMethod('POST');
            rm.setRequestHeader('Content-Type', 'application/json');
            rm.setRequestHeader('Accept', 'application/json');
            rm.setRequestBody(JSON.stringify({
                prompt: prompt,
                max_tokens: 500,
                temperature: 0.3
            }));

            var response = rm.execute();
            var statusCode = response.getStatusCode();

            if (statusCode === 200) {
                var body = JSON.parse(response.getBody());
                return {
                    success: true,
                    summary: body.summary || body.response || '',
                    root_cause: body.root_cause || '',
                    suggested_fix: body.suggested_fix || '',
                    confidence: body.confidence || 70
                };
            }
        } catch (e) {
            gs.warn('TraceAnalyzer: Now Assist API call failed: ' + e.toString());
        }
        return { success: false };
    },

    /**
     * Rule-based fallback explanation when AI is unavailable.
     * @private
     */
    _ruleBasedExplanation: function(traceResult, userQuestion) {
        var explanation = {
            summary: '',
            root_cause: '',
            suggested_fix: '',
            confidence: 50
        };

        var summary = traceResult.summary;

        if (summary.total_events === 0) {
            explanation.root_cause = 'No events were emitted for this record. The notification trigger may not be configured for this table or the record state did not meet the event generation criteria.';
            explanation.suggested_fix = 'Verify that event rules exist for table "' + traceResult.source.table + '" and that the record state matches the expected trigger conditions.';
        } else if (summary.total_rules_matched === 0 && summary.total_rules_skipped > 0) {
            explanation.root_cause = summary.total_events + ' event(s) were emitted but all ' + summary.total_rules_skipped + ' rule(s) were skipped. The event rules exist but their conditions did not match the event parameters.';
            explanation.suggested_fix = 'Review the conditions on the skipped rules. Check if event parameters (parm1, parm2, state) match the expected values in the rule conditions.';
        } else if (summary.total_emails_sent === 0 && summary.total_rules_matched > 0) {
            explanation.root_cause = summary.total_rules_matched + ' rule(s) matched but no email actions were triggered. The matched rules may not have email actions configured, or the email actions are inactive.';
            explanation.suggested_fix = 'Check the matched rules for associated email actions (sysevent_email_action). Verify the email actions are active and have valid recipients configured.';
        } else if (summary.total_bounced > 0) {
            explanation.root_cause = summary.total_bounced + ' out of ' + summary.total_emails_sent + ' emails bounced or failed. This indicates a delivery problem — invalid recipients, mailbox full, or email server connectivity issues.';
            explanation.suggested_fix = 'Check the sys_email_log for bounce details. Verify recipient email addresses are valid. Check email account health in sys_email_account.';
        } else if (summary.total_pending > 0) {
            explanation.root_cause = summary.total_pending + ' email(s) are still pending delivery. This may indicate a backlog in the email queue or the SMTP sender is not processing.';
            explanation.suggested_fix = 'Check the email queue (sys_email, type=send-ready). Verify the email sender scheduled job is running. Check email account connectivity.';
        } else {
            explanation.root_cause = 'All notifications appear to have been delivered successfully. If the user did not receive the email, the issue may be on the recipient side (spam filter, wrong address, mailbox rules).';
            explanation.suggested_fix = 'Verify the recipient email address in the delivered email record. Check if the email was caught by a spam filter. Confirm the recipient mailbox is active.';
        }

        explanation.summary = explanation.root_cause;
        return explanation;
    },

    /**
     * Store a health snapshot in the trace result table.
     * @param {object} healthSnapshot — from computeHealth()
     * @return {string} sys_id of the created record
     */
    storeHealthSnapshot: function(healthSnapshot) {
        try {
            var gr = new GlideRecord('x_ntrc_trace_result');
            gr.initialize();
            gr.setValue('source_table', 'global');
            gr.setValue('source_sys_id', 'health_snapshot');
            gr.setValue('trace_type', 'health');
            gr.setValue('trace_json', JSON.stringify(healthSnapshot));
            gr.setValue('health_score', healthSnapshot.health_score || 0);
            gr.setValue('overlap_count', healthSnapshot.rule_stats ? healthSnapshot.rule_stats.overlapping : 0);
            gr.setValue('failure_count', healthSnapshot.delivery_stats ? healthSnapshot.delivery_stats.failed : 0);
            gr.setValue('executed_at', new GlideDateTime().getDisplayValue());
            return gr.insert();
        } catch (e) {
            gs.error('TraceAnalyzer: Failed to store health snapshot: ' + e.toString());
            return null;
        }
    },

    /**
     * Store overlap scan results.
     * @param {object[]} overlaps — from detectOverlaps()
     * @return {string} sys_id of the created record
     */
    storeOverlapResults: function(overlaps) {
        try {
            var gr = new GlideRecord('x_ntrc_trace_result');
            gr.initialize();
            gr.setValue('source_table', 'sysevent_rule');
            gr.setValue('source_sys_id', 'overlap_scan');
            gr.setValue('trace_type', 'overlap');
            gr.setValue('trace_json', JSON.stringify(overlaps));
            gr.setValue('overlap_count', overlaps.length);
            gr.setValue('executed_at', new GlideDateTime().getDisplayValue());
            return gr.insert();
        } catch (e) {
            gs.error('TraceAnalyzer: Failed to store overlap results: ' + e.toString());
            return null;
        }
    },

    /**
     * Clean up trace results older than retention_days.
     * @param {number} retentionDays — default 90
     */
    cleanupOldResults: function(retentionDays) {
        retentionDays = retentionDays || 90;
        var cutoff = new GlideDateTime();
        cutoff.addSeconds(-retentionDays * 86400);

        var gr = new GlideRecord('x_ntrc_trace_result');
        gr.addQuery('executed_at', '<=', cutoff.getDisplayValue());
        gr.query();

        var deleted = 0;
        while (gr.next()) {
            try {
                gr.deleteRecord();
                deleted++;
            } catch (e) {
                gs.warn('TraceAnalyzer: Failed to delete trace result ' + gr.getValue('sys_id') + ': ' + e.toString());
            }
        }

        gs.info('TraceAnalyzer: Cleaned up ' + deleted + ' trace results older than ' + retentionDays + ' days');
        return deleted;
    },

    type: 'TraceAnalyzer'
};