/**
 * Copyright (c) 2026 Vladimir Kapustin
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Business Rule: Auto-compute risk level on finding insert
 * Table: x_usi_inspector_finding
 * When: before insert
 * Order: 100
 *
 * Automatically computes the risk_level field based on finding_type and severity,
 * so that callers don't need to set it manually.
 */
(function executeRule(current, previous) {
    // Only run on insert
    if (current.operation() !== 'insert') {
        return;
    }

    // Auto-compute risk_level from severity if not already set or is default
    var currentRisk = current.getValue('risk_level');
    if (!currentRisk || currentRisk === 'GREEN') {
        var severity = current.getValue('severity');
        if (severity === 'HIGH') {
            current.setValue('risk_level', 'RED');
        } else if (severity === 'MEDIUM') {
            current.setValue('risk_level', 'YELLOW');
        } else {
            current.setValue('risk_level', 'GREEN');
        }
    }

    // Auto-set status to 'new' if not specified
    var status = current.getValue('status');
    if (!status) {
        current.setValue('status', 'new');
    }

    // Ensure scan_batch_id is set
    var batchId = current.getValue('scan_batch_id');
    if (!batchId) {
        current.setValue('scan_batch_id', 'USI_AUTO_' + gs.generateGUID());
    }
})(current, previous);