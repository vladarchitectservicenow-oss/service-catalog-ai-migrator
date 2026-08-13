// Now Assist Cost Lens — NACLAnalyticsEngine
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Computes ROI, waste detection, budget forecasting, feature breakdown,
// optimization recommendations, anomaly detection, and summary reports.
// @class NACLAnalyticsEngine @namespace x_nacl

var NACLAnalyticsEngine = Class.create();
NACLAnalyticsEngine.prototype = {
    initialize: function() {
        this.tracker = new NACLCostTracker();
    },

    /**
     * Compute ROI: AI cost vs estimated human cost avoided.
     * @param {number} periodDays - lookback period in days
     * @returns {object} ROI report
     */
    computeROI: function(periodDays) {
        periodDays = periodDays || 30;
        var config = this.tracker.getCostConfig();
        var humanCostPerTicket = parseFloat(config.human_cost_per_ticket) || 0;

        var sinceGdt = new GlideDateTime();
        sinceGdt.addSeconds(-periodDays * 86400);

        var logGr = new GlideRecord('x_nacl_interaction_log');
        logGr.addQuery('captured_at', '>=', sinceGdt.toString());
        logGr.query();

        var totalAICost = 0;
        var resolvedByAI = 0;
        var totalInteractions = 0;
        var escalatedCount = 0;
        var abandonedCount = 0;
        var loopedCount = 0;

        while (logGr.next()) {
            totalInteractions++;
            totalAICost += parseFloat(logGr.getValue('computed_cost')) || 0;
            var outcome = logGr.getValue('outcome') || 'unknown';
            if (outcome === 'resolved') {
                resolvedByAI++;
            } else if (outcome === 'escalated') {
                escalatedCount++;
            } else if (outcome === 'abandoned') {
                abandonedCount++;
            } else if (outcome === 'looped') {
                loopedCount++;
            }
        }

        var humanCostAvoided = resolvedByAI * humanCostPerTicket;
        var netSavings = humanCostAvoided - totalAICost;
        var costPerResolution = resolvedByAI > 0 ? totalAICost / resolvedByAI : 0;
        var resolutionRate = totalInteractions > 0 ? (resolvedByAI / totalInteractions) * 100 : 0;

        return {
            period_days: periodDays,
            total_interactions: totalInteractions,
            total_ai_cost: parseFloat(totalAICost.toFixed(2)),
            human_cost_avoided: parseFloat(humanCostAvoided.toFixed(2)),
            net_savings: parseFloat(netSavings.toFixed(2)),
            cost_per_resolution: parseFloat(costPerResolution.toFixed(4)),
            resolution_rate: parseFloat(resolutionRate.toFixed(1)),
            resolved_count: resolvedByAI,
            escalated_count: escalatedCount,
            abandoned_count: abandonedCount,
            looped_count: loopedCount,
            break_even: humanCostPerTicket > 0 ? parseFloat((totalAICost / humanCostPerTicket).toFixed(1)) : 0
        };
    },

    /**
     * Detect low-value / wasteful interactions.
     * @param {number} periodDays - lookback period
     * @returns {object} waste report with top-10 wasters
     */
    detectWaste: function(periodDays) {
        periodDays = periodDays || 7;
        var config = this.tracker.getCostConfig();
        var wasteThreshold = parseFloat(config.waste_threshold_cost) || 0;

        var sinceGdt = new GlideDateTime();
        sinceGdt.addSeconds(-periodDays * 86400);

        var logGr = new GlideRecord('x_nacl_interaction_log');
        logGr.addQuery('captured_at', '>=', sinceGdt.toString());
        logGr.addQuery('outcome', 'IN', 'escalated,abandoned,looped');
        logGr.orderByDesc('computed_cost');
        logGr.query();

        var wasters = [];
        var totalWasteCost = 0;
        var count = 0;

        while (logGr.next()) {
            var cost = parseFloat(logGr.getValue('computed_cost')) || 0;
            if (wasteThreshold > 0 && cost < wasteThreshold) {
                continue;
            }
            totalWasteCost += cost;
            count++;
            if (wasters.length < 10) {
                wasters.push({
                    sys_id: logGr.getUniqueValue(),
                    conversation_id: logGr.getValue('conversation_id') || '',
                    feature_type: logGr.getValue('feature_type') || '',
                    outcome: logGr.getValue('outcome') || '',
                    computed_cost: cost,
                    topic: logGr.getValue('topic') || '',
                    captured_at: logGr.getValue('captured_at') || ''
                });
            }
        }

        return {
            period_days: periodDays,
            total_waste_interactions: count,
            total_waste_cost: parseFloat(totalWasteCost.toFixed(2)),
            top_wasters: wasters
        };
    },

    /**
     * Forecast next month's spend using linear regression on 30-day trend.
     * @param {number} projectionDays - days to project forward
     * @returns {object} forecast report
     */
    forecastSpend: function(projectionDays) {
        projectionDays = projectionDays || 30;
        var config = this.tracker.getCostConfig();
        var budgetLimit = parseFloat(config.budget_monthly_limit) || 0;
        var confidence = parseFloat(config.forecast_confidence) || 0.68;

        // Collect daily costs for last 30 days
        var sinceGdt = new GlideDateTime();
        sinceGdt.addSeconds(-30 * 86400);

        var logGr = new GlideRecord('x_nacl_interaction_log');
        logGr.addQuery('captured_at', '>=', sinceGdt.toString());
        logGr.orderBy('captured_at');
        logGr.query();

        var dailyCosts = {};
        while (logGr.next()) {
            var capturedAt = logGr.getValue('captured_at') || '';
            if (!capturedAt) {
                continue;
            }
            var day = capturedAt.substring(0, 10);
            if (!dailyCosts[day]) {
                dailyCosts[day] = 0;
            }
            dailyCosts[day] += parseFloat(logGr.getValue('computed_cost')) || 0;
        }

        var days = Object.keys(dailyCosts).sort();
        if (days.length < 3) {
            return {
                projection_days: projectionDays,
                projected_cost: 0,
                confidence_low: 0,
                confidence_high: 0,
                budget_limit: budgetLimit,
                exceeds_budget: false,
                data_points: days.length,
                error: 'Insufficient data for forecast (need >= 3 days)'
            };
        }

        // Linear regression
        var points = [];
        for (var i = 0; i < days.length; i++) {
            points.push({ x: i, y: dailyCosts[days[i]] });
        }

        var reg = this._linearRegression(points);
        var dailyProjection = reg.slope * (days.length + projectionDays) + reg.intercept;
        var projectedCost = Math.max(0, dailyProjection * projectionDays);

        // Standard deviation for confidence bands
        var residuals = [];
        for (var j = 0; j < points.length; j++) {
            var predicted = reg.slope * points[j].x + reg.intercept;
            residuals.push(points[j].y - predicted);
        }
        var stdDev = this._standardDeviation(residuals);
        var zScore = this._zScoreForConfidence(confidence);

        var confidenceLow = Math.max(0, projectedCost - zScore * stdDev * projectionDays);
        var confidenceHigh = projectedCost + zScore * stdDev * projectionDays;

        return {
            projection_days: projectionDays,
            projected_cost: parseFloat(projectedCost.toFixed(2)),
            confidence_low: parseFloat(confidenceLow.toFixed(2)),
            confidence_high: parseFloat(confidenceHigh.toFixed(2)),
            budget_limit: budgetLimit,
            exceeds_budget: budgetLimit > 0 && projectedCost > budgetLimit,
            data_points: days.length,
            r_squared: parseFloat(reg.r2.toFixed(4)),
            daily_trend: parseFloat(reg.slope.toFixed(4))
        };
    },

    /**
     * Get feature-level cost breakdown.
     * @param {number} periodDays - lookback period
     * @returns {object} feature breakdown report
     */
    getFeatureBreakdown: function(periodDays) {
        periodDays = periodDays || 30;

        var sinceGdt = new GlideDateTime();
        sinceGdt.addSeconds(-periodDays * 86400);

        var logGr = new GlideRecord('x_nacl_interaction_log');
        logGr.addQuery('captured_at', '>=', sinceGdt.toString());
        logGr.query();

        var features = {};
        while (logGr.next()) {
            var ft = logGr.getValue('feature_type') || 'other';
            if (!features[ft]) {
                features[ft] = {
                    feature_type: ft,
                    total_cost: 0,
                    interaction_count: 0,
                    resolved_count: 0
                };
            }
            features[ft].total_cost += parseFloat(logGr.getValue('computed_cost')) || 0;
            features[ft].interaction_count++;
            if (logGr.getValue('outcome') === 'resolved') {
                features[ft].resolved_count++;
            }
        }

        var breakdown = [];
        for (var key in features) {
            if (features.hasOwnProperty(key)) {
                var f = features[key];
                breakdown.push({
                    feature_type: f.feature_type,
                    total_cost: parseFloat(f.total_cost.toFixed(2)),
                    interaction_count: f.interaction_count,
                    avg_cost_per_interaction: f.interaction_count > 0 ? parseFloat((f.total_cost / f.interaction_count).toFixed(4)) : 0,
                    resolution_rate: f.interaction_count > 0 ? parseFloat(((f.resolved_count / f.interaction_count) * 100).toFixed(1)) : 0,
                    cost_per_resolution: f.resolved_count > 0 ? parseFloat((f.total_cost / f.resolved_count).toFixed(4)) : 0
                });
            }
        }

        breakdown.sort(function(a, b) {
            return b.total_cost - a.total_cost;
        });

        return {
            period_days: periodDays,
            features: breakdown
        };
    },

    /**
     * Get optimization recommendations.
     * Uses deterministic rules; optionally calls GenAI Controller for natural-language expansion.
     * @returns {object[]} ranked recommendations
     */
    getOptimizationRecommendations: function() {
        var config = this.tracker.getCostConfig();
        var breakdown = this.getFeatureBreakdown(30);
        var waste = this.detectWaste(30);
        var recommendations = [];

        // Rule 1: Low resolution rate → deflect
        for (var i = 0; i < breakdown.features.length; i++) {
            var f = breakdown.features[i];
            if (f.resolution_rate < 20 && f.interaction_count >= 10) {
                recommendations.push({
                    priority: 'high',
                    category: 'deflection',
                    feature_type: f.feature_type,
                    finding: 'Resolution rate below 20% (' + f.resolution_rate + '%)',
                    recommendation: 'Consider adding deflection rules or routing to human agents for this feature.',
                    estimated_monthly_savings: parseFloat((f.total_cost * 0.8).toFixed(2)),
                    implementation_difficulty: 'medium'
                });
            }
        }

        // Rule 2: High loop rate → redesign topic
        var loopedCost = 0;
        for (var j = 0; j < waste.top_wasters.length; j++) {
            if (waste.top_wasters[j].outcome === 'looped') {
                loopedCost += waste.top_wasters[j].computed_cost;
            }
        }
        if (loopedCost > 0) {
            recommendations.push({
                priority: 'high',
                category: 'redesign',
                feature_type: 'virtual_agent',
                finding: 'Looped interactions detected — same question asked 3+ times',
                recommendation: 'Redesign VA topics with high loop rates. Add clearer prompts or fallback to human agent after 2 loops.',
                estimated_monthly_savings: parseFloat(loopedCost.toFixed(2)),
                implementation_difficulty: 'medium'
            });
        }

        // Rule 3: Cost growth > 50% → investigate
        var forecast = this.forecastSpend(30);
        var roi = this.computeROI(30);
        if (roi.total_ai_cost > 0 && forecast.projected_cost > roi.total_ai_cost * 1.5) {
            recommendations.push({
                priority: 'medium',
                category: 'investigate',
                feature_type: 'all',
                finding: 'Projected cost growth exceeds 50% over current spend',
                recommendation: 'Investigate cause of cost growth. Check for new Now Assist skills deployed, user growth, or configuration changes.',
                estimated_monthly_savings: parseFloat((forecast.projected_cost - roi.total_ai_cost).toFixed(2)),
                implementation_difficulty: 'low'
            });
        }

        // Rule 4: Budget exceeded
        if (forecast.exceeds_budget) {
            recommendations.push({
                priority: 'critical',
                category: 'budget',
                feature_type: 'all',
                finding: 'Projected spend (' + forecast.projected_cost.toFixed(2) + ') exceeds budget limit (' + forecast.budget_limit.toFixed(2) + ')',
                recommendation: 'Review Now Assist usage immediately. Consider disabling low-value features or negotiating SKU pricing.',
                estimated_monthly_savings: parseFloat((forecast.projected_cost - forecast.budget_limit).toFixed(2)),
                implementation_difficulty: 'low'
            });
        }

        // Rule 5: Underutilized features
        var allFeatureTypes = ['virtual_agent', 'incident_ar', 'case_summary', 'chat_summary', 'flow_gen', 'catalog_gen'];
        var usedFeatures = {};
        for (var k = 0; k < breakdown.features.length; k++) {
            usedFeatures[breakdown.features[k].feature_type] = true;
        }
        for (var m = 0; m < allFeatureTypes.length; m++) {
            if (!usedFeatures[allFeatureTypes[m]]) {
                recommendations.push({
                    priority: 'low',
                    category: 'adoption',
                    feature_type: allFeatureTypes[m],
                    finding: 'Feature not in use',
                    recommendation: 'This Now Assist feature is available but not being used. Evaluate whether it could reduce human workload.',
                    estimated_monthly_savings: 0,
                    implementation_difficulty: 'low'
                });
            }
        }

        // Sort by priority
        var priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        recommendations.sort(function(a, b) {
            return (priorityOrder[a.priority] || 99) - (priorityOrder[b.priority] || 99);
        });

        return {
            generated_at: new GlideDateTime().toString(),
            ai_enhanced: config.ai_recommendations === 'true',
            recommendations: recommendations
        };
    },

    /**
     * Get dashboard-ready summary.
     * @returns {object} summary report
     */
    getSummary: function() {
        var roi = this.computeROI(30);
        var waste = this.detectWaste(7);
        var forecast = this.forecastSpend(30);
        var breakdown = this.getFeatureBreakdown(30);

        return {
            total_spend_30d: roi.total_ai_cost,
            cost_per_resolution: roi.cost_per_resolution,
            resolution_rate: roi.resolution_rate,
            net_savings_30d: roi.net_savings,
            waste_total_7d: waste.total_waste_cost,
            waste_interactions_7d: waste.total_waste_interactions,
            projected_next_month: forecast.projected_cost,
            exceeds_budget: forecast.exceeds_budget,
            budget_limit: forecast.budget_limit,
            top_feature_by_cost: breakdown.features.length > 0 ? breakdown.features[0].feature_type : 'none',
            total_interactions_30d: roi.total_interactions,
            roi_status: roi.net_savings > 0 ? 'positive' : (roi.net_savings < 0 ? 'negative' : 'neutral')
        };
    },

    /**
     * Check for cost anomalies using Z-score detection.
     * @returns {object[]} detected anomalies
     */
    checkAnomalies: function() {
        var config = this.tracker.getCostConfig();
        var zThreshold = parseFloat(config.anomaly_zscore) || 2.5;

        // Collect daily costs for last 14 days
        var sinceGdt = new GlideDateTime();
        sinceGdt.addSeconds(-14 * 86400);

        var logGr = new GlideRecord('x_nacl_interaction_log');
        logGr.addQuery('captured_at', '>=', sinceGdt.toString());
        logGr.orderBy('captured_at');
        logGr.query();

        var dailyCosts = {};
        var dailyCounts = {};
        while (logGr.next()) {
            var capturedAt = logGr.getValue('captured_at') || '';
            if (!capturedAt) {
                continue;
            }
            var day = capturedAt.substring(0, 10);
            if (!dailyCosts[day]) {
                dailyCosts[day] = 0;
                dailyCounts[day] = 0;
            }
            dailyCosts[day] += parseFloat(logGr.getValue('computed_cost')) || 0;
            dailyCounts[day]++;
        }

        var days = Object.keys(dailyCosts).sort();
        if (days.length < 5) {
            return [];
        }

        // Compute mean and std dev
        var costValues = [];
        for (var i = 0; i < days.length; i++) {
            costValues.push(dailyCosts[days[i]]);
        }

        var mean = this._mean(costValues);
        var stdDev = this._standardDeviation(costValues);
        if (stdDev === 0) {
            return [];
        }

        var anomalies = [];
        for (var j = 0; j < days.length; j++) {
            var zScore = (dailyCosts[days[j]] - mean) / stdDev;
            if (Math.abs(zScore) > zThreshold) {
                anomalies.push({
                    date: days[j],
                    daily_cost: parseFloat(dailyCosts[days[j]].toFixed(2)),
                    z_score: parseFloat(zScore.toFixed(2)),
                    interaction_count: dailyCounts[days[j]] || 0,
                    direction: zScore > 0 ? 'spike' : 'drop'
                });
            }
        }

        // Fire alerts for anomalies
        for (var k = 0; k < anomalies.length; k++) {
            this._fireAlert(anomalies[k]);
        }

        return anomalies;
    },

    /**
     * Linear regression on points [{x, y}, ...].
     * @param {object[]} points
     * @returns {object} {slope, intercept, r2}
     * @private
     */
    _linearRegression: function(points) {
        var n = points.length;
        if (n < 2) {
            return { slope: 0, intercept: 0, r2: 0 };
        }

        var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
        for (var i = 0; i < n; i++) {
            sumX += points[i].x;
            sumY += points[i].y;
            sumXY += points[i].x * points[i].y;
            sumX2 += points[i].x * points[i].x;
            sumY2 += points[i].y * points[i].y;
        }

        var slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        var intercept = (sumY - slope * sumX) / n;

        // R-squared
        var ssRes = 0, ssTot = 0;
        var meanY = sumY / n;
        for (var j = 0; j < n; j++) {
            var predicted = slope * points[j].x + intercept;
            ssRes += Math.pow(points[j].y - predicted, 2);
            ssTot += Math.pow(points[j].y - meanY, 2);
        }
        var r2 = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;

        return { slope: slope, intercept: intercept, r2: r2 };
    },

    /**
     * Compute mean of an array.
     * @param {number[]} values
     * @returns {number}
     * @private
     */
    _mean: function(values) {
        if (values.length === 0) {
            return 0;
        }
        var sum = 0;
        for (var i = 0; i < values.length; i++) {
            sum += values[i];
        }
        return sum / values.length;
    },

    /**
     * Compute standard deviation.
     * @param {number[]} values
     * @returns {number}
     * @private
     */
    _standardDeviation: function(values) {
        if (values.length < 2) {
            return 0;
        }
        var mean = this._mean(values);
        var sumSqDiff = 0;
        for (var i = 0; i < values.length; i++) {
            sumSqDiff += Math.pow(values[i] - mean, 2);
        }
        return Math.sqrt(sumSqDiff / (values.length - 1));
    },

    /**
     * Map confidence level to z-score using a lookup table.
     * Common confidence levels: 0.68→1.0, 0.80→1.28, 0.90→1.645, 0.95→1.96, 0.99→2.576
     * @param {number} confidence - confidence level (0-1)
     * @returns {number} z-score
     * @private
     */
    _zScoreForConfidence: function(confidence) {
        var lookup = [
            { c: 0.99, z: 2.576 },
            { c: 0.95, z: 1.960 },
            { c: 0.90, z: 1.645 },
            { c: 0.85, z: 1.440 },
            { c: 0.80, z: 1.282 },
            { c: 0.75, z: 1.150 },
            { c: 0.70, z: 1.036 },
            { c: 0.68, z: 1.000 }
        ];
        for (var i = 0; i < lookup.length; i++) {
            if (confidence >= lookup[i].c) {
                return lookup[i].z;
            }
        }
        return 1.0; // default for low confidence
    },

    /**
     * Fire alert for an anomaly.
     * Sends email and/or Slack notification if configured.
     * @param {object} anomaly
     * @private
     */
    _fireAlert: function(anomaly) {
        var config = this.tracker.getCostConfig();

        var message = 'Now Assist Cost Lens — Anomaly Detected\n' +
            'Date: ' + anomaly.date + '\n' +
            'Daily Cost: ' + anomaly.daily_cost.toFixed(2) + '\n' +
            'Z-Score: ' + anomaly.z_score.toFixed(2) + '\n' +
            'Direction: ' + anomaly.direction + '\n' +
            'Interactions: ' + anomaly.interaction_count;

        // Email alert
        var recipients = config.alert_email_recipients;
        if (recipients) {
            try {
                gs.email.send(recipients, 'Now Assist Cost Lens — Anomaly Detected', message);
            } catch (e) {
                gs.error('NACLAnalyticsEngine: Email alert failed: ' + e.message);
            }
        }

        // Slack webhook
        var webhook = config.alert_slack_webhook;
        if (webhook) {
            try {
                var rm = new sn_ws.RESTMessageV2();
                rm.setEndpoint(webhook);
                rm.setHttpMethod('POST');
                rm.setRequestHeader('Content-Type', 'application/json');
                var payload = {
                    text: ':warning: *Now Assist Cost Anomaly*\n' +
                          'Date: ' + anomaly.date + '\n' +
                          'Cost: $' + anomaly.daily_cost.toFixed(2) + '\n' +
                          'Z-Score: ' + anomaly.z_score.toFixed(2) + ' (' + anomaly.direction + ')\n' +
                          'Interactions: ' + anomaly.interaction_count
                };
                rm.setRequestBody(JSON.stringify(payload));
                rm.execute();
            } catch (e) {
                gs.error('NACLAnalyticsEngine: Slack webhook failed: ' + e.message);
            }
        }
    },

    type: 'NACLAnalyticsEngine'
};
