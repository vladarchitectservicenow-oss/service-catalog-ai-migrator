// JobPulse — Scheduled Job Health & Overlap Monitor
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// JobPulseConfig — shared configuration reader.
// @class JobPulseConfig @namespace x_jbpls

var JobPulseConfig = Class.create();
JobPulseConfig.prototype = {

    initialize: function() {
        this.configTable = 'x_jbpls_jobpulse_config';
    },

    get: function(key, defaultValue) {
        var gr = new GlideRecord(this.configTable);
        gr.addQuery('config_key', '=', key);
        gr.query();
        if (gr.next()) return gr.getValue('config_value');
        return defaultValue;
    },

    type: 'JobPulseConfig'
};
