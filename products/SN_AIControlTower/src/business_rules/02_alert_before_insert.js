// Copyright (c) 2026 Vladimir Kapustin. Licensed under AGPL-3.0.
// Business Rule: AI Tower Alert Before Insert
// Table: x_snc_ai_tower_alert | When: before | Insert: true
(function executeRule(current, previous) {
    if (!current.getValue('detected_at')) {
        current.setValue('detected_at', new GlideDateTime());
    }
    if (!current.getValue('status')) {
        current.setValue('status', 'new');
    }
})(current, previous);
