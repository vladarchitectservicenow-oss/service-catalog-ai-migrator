// SN Demo Data Generator — PADataScanner
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Scans PA dashboards, indicators, breakdowns, and resolves dependencies.
// @class PADataScanner @namespace x_sn_demo_data_gen

var PADataScanner = Class.create();
PADataScanner.prototype = {
    initialize: function() {
        this._indicatorCache = {};
        this._breakdownCache = {};
        this._widgetCache = {};
    },

    /**
     * Scan a dashboard and return all linked indicators, breakdowns, and widgets.
     * @param {string} dashboardSysId - sys_id of pa_dashboards record
     * @return {object} { dashboard: {...}, indicators: [...], breakdowns: [...], widgets: [...] }
     */
    scanDashboard: function(dashboardSysId) {
        var result = {
            dashboard: null,
            indicators: [],
            breakdowns: [],
            widgets: []
        };

        var dashGr = new GlideRecord('pa_dashboards');
        if (!dashGr.get(dashboardSysId)) {
            return result;
        }
        result.dashboard = {
            sys_id: dashGr.getUniqueValue(),
            name: dashGr.getValue('name') || '',
            description: dashGr.getValue('description') || ''
        };

        result.widgets = this._scanWidgets(dashboardSysId);
        result.indicators = this._scanIndicators(dashboardSysId);
        result.breakdowns = this._scanBreakdowns(dashboardSysId);

        return result;
    },

    /**
     * Scan all indicators linked to a dashboard via widgets.
     * @param {string} dashboardSysId
     * @return {array} indicator objects
     */
    _scanIndicators: function(dashboardSysId) {
        var indicators = [];
        var seen = {};

        var widgetGr = new GlideRecord('pa_widgets');
        widgetGr.addQuery('dashboard', dashboardSysId);
        widgetGr.query();
        while (widgetGr.next()) {
            var indicatorId = widgetGr.getValue('indicator') || '';
            if (indicatorId && !seen[indicatorId]) {
                seen[indicatorId] = true;
                var ind = this._getIndicator(indicatorId);
                if (ind) {
                    indicators.push(ind);
                }
            }
        }
        return indicators;
    },

    /**
     * Scan all breakdowns linked to a dashboard's indicators.
     * @param {string} dashboardSysId
     * @return {array} breakdown objects
     */
    _scanBreakdowns: function(dashboardSysId) {
        var breakdowns = [];
        var seen = {};

        var widgetGr = new GlideRecord('pa_widgets');
        widgetGr.addQuery('dashboard', dashboardSysId);
        widgetGr.query();
        while (widgetGr.next()) {
            var bdId = widgetGr.getValue('breakdown') || '';
            if (bdId && !seen[bdId]) {
                seen[bdId] = true;
                var bd = this._getBreakdown(bdId);
                if (bd) {
                    breakdowns.push(bd);
                }
            }
        }
        return breakdowns;
    },

    /**
     * Scan all widgets on a dashboard.
     * @param {string} dashboardSysId
     * @return {array} widget objects
     */
    _scanWidgets: function(dashboardSysId) {
        var widgets = [];
        var widgetGr = new GlideRecord('pa_widgets');
        widgetGr.addQuery('dashboard', dashboardSysId);
        widgetGr.query();
        while (widgetGr.next()) {
            widgets.push({
                sys_id: widgetGr.getUniqueValue(),
                name: widgetGr.getValue('name') || '',
                indicator: widgetGr.getValue('indicator') || '',
                breakdown: widgetGr.getValue('breakdown') || '',
                widget_type: widgetGr.getValue('type') || ''
            });
        }
        return widgets;
    },

    /**
     * Get indicator details by sys_id.
     * @param {string} indicatorId
     * @return {object|null}
     */
    _getIndicator: function(indicatorId) {
        if (this._indicatorCache[indicatorId]) {
            return this._indicatorCache[indicatorId];
        }
        var gr = new GlideRecord('pa_indicators');
        if (!gr.get(indicatorId)) {
            return null;
        }
        var ind = {
            sys_id: gr.getUniqueValue(),
            name: gr.getValue('name') || '',
            description: gr.getValue('description') || '',
            unit: gr.getValue('unit') || '',
            frequency: gr.getValue('frequency') || 'daily',
            direction: gr.getValue('direction') || 'maximize',
            automated: gr.getValue('automated') === '1' || gr.getValue('automated') === true
        };
        this._indicatorCache[indicatorId] = ind;
        return ind;
    },

    /**
     * Get breakdown details by sys_id.
     * @param {string} breakdownId
     * @return {object|null}
     */
    _getBreakdown: function(breakdownId) {
        if (this._breakdownCache[breakdownId]) {
            return this._breakdownCache[breakdownId];
        }
        var gr = new GlideRecord('pa_breakdowns');
        if (!gr.get(breakdownId)) {
            return null;
        }
        var bd = {
            sys_id: gr.getUniqueValue(),
            name: gr.getValue('name') || '',
            type: gr.getValue('type') || '',
            element: gr.getValue('element') || ''
        };
        this._breakdownCache[breakdownId] = bd;
        return bd;
    },

    /**
     * Resolve breakdown element values for a given breakdown.
     * @param {string} breakdownId
     * @return {array} breakdown element values
     */
    resolveBreakdownElements: function(breakdownId) {
        var elements = [];
        var bd = this._getBreakdown(breakdownId);
        if (!bd || !bd.element) {
            return elements;
        }

        var elemGr = new GlideRecord('sys_choice');
        elemGr.addQuery('name', bd.element);
        elemGr.addQuery('inactive', false);
        elemGr.query();
        while (elemGr.next()) {
            elements.push({
                value: elemGr.getValue('value') || '',
                label: elemGr.getValue('label') || ''
            });
        }
        return elements;
    },

    /**
     * Resolve all dependencies for a dashboard: indicators, breakdowns, and their elements.
     * @param {string} dashboardSysId
     * @return {object} full dependency tree
     */
    resolveDependencies: function(dashboardSysId) {
        var scan = this.scanDashboard(dashboardSysId);
        var result = {
            dashboard: scan.dashboard,
            indicators: scan.indicators,
            breakdowns: [],
            widgets: scan.widgets
        };

        for (var i = 0; i < scan.breakdowns.length; i++) {
            var bd = scan.breakdowns[i];
            bd.elements = this.resolveBreakdownElements(bd.sys_id);
            result.breakdowns.push(bd);
        }

        return result;
    },

    type: 'PADataScanner'
};
