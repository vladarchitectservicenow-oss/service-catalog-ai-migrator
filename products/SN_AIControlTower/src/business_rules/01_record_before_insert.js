// Copyright (c) 2026 Vladimir Kapustin. Licensed under AGPL-3.0.
// Business Rule: AI Tower Record Before Insert
// Table: x_snc_ai_tower_record | When: before | Insert: true
(function executeRule(current, previous) {
    if (!current.getValue('sync_timestamp')) {
        current.setValue('sync_timestamp', new GlideDateTime());
    }
    if (!current.getValue('request_count')) {
        current.setValue('request_count', '1');
    }
    if (!current.getValue('success_count')) {
        current.setValue('success_count', '0');
    }
    if (!current.getValue('failure_count')) {
        current.setValue('failure_count', '0');
    }
})(current, previous);
