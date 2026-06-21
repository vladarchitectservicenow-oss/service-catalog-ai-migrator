/**
 * Copyright (c) 2026 Vladimir Kapustin
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Business Rule: Auto-set status on audit record insert
 * Table: x_usi_inspector_audit
 * When: before insert
 * Order: 100
 *
 * Automatically sets default status and validates required fields
 * on audit record creation.
 */
(function executeRule(current, previous) {
    // Only run on insert
    if (current.operation() !== 'insert') {
        return;
    }

    // Auto-set status to 'pending' if not specified
    var status = current.getValue('status');
    if (!status) {
        current.setValue('status', 'pending');
    }

    // Auto-set risk_level to 'GREEN' if not specified
    var riskLevel = current.getValue('risk_level');
    if (!riskLevel) {
        current.setValue('risk_level', 'GREEN');
    }

    // Ensure record_type is set
    var recordType = current.getValue('record_type');
    if (!recordType) {
        current.setValue('record_type', 'scan_meta');
    }

    // Ensure update_set_name is set — try to resolve from update_set_sys_id
    var updateSetName = current.getValue('update_set_name');
    var updateSetSysId = current.getValue('update_set_sys_id');
    if (!updateSetName && updateSetSysId) {
        try {
            var gr = new GlideRecord('sys_update_set');
            if (gr.get(updateSetSysId)) {
                current.setValue('update_set_name', gr.getValue('name'));
            }
        } catch (e) {
            // ignore — field will remain empty
        }
    }
})(current, previous);