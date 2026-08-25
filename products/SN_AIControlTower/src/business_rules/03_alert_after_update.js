// Copyright (c) 2026 Vladimir Kapustin. Licensed under AGPL-3.0.
// Business Rule: AI Tower Alert After Update
// Table: x_snc_ai_tower_alert | When: after | Update: true
(function executeRule(current, previous) {
    var prevStatus = previous ? previous.getValue('status') : '';
    var currStatus = current.getValue('status');
    if (currStatus === 'resolved' && prevStatus !== 'resolved') {
        if (!current.getValue('resolved_at')) {
            current.setValue('resolved_at', new GlideDateTime());
        }
        if (!current.getValue('resolved_by')) {
            current.setValue('resolved_by', gs.getUserID());
        }
    }
    if (currStatus === 'acknowledged' && prevStatus !== 'acknowledged') {
        if (!current.getValue('acknowledged_at')) {
            current.setValue('acknowledged_at', new GlideDateTime());
        }
        if (!current.getValue('acknowledged_by')) {
            current.setValue('acknowledged_by', gs.getUserID());
        }
    }
})(current, previous);
