// DemoSeed — BR2: Auto-Wipe Audit Entries on Batch Wipe
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Table: x_demoseed_audit
// When: after update
// Order: 200
// Condition: current.status.changesTo('wiped')

(function executeRule(current, previous /*null when async*/) {
    // Only act on batch header records
    if (current.is_batch_header !== 'true') return;

    // Only trigger when status changes to 'wiped'
    if (!current.status.changesTo('wiped')) return;

    // Mark all child audit entries as wiped
    var childGr = new GlideRecord('x_demoseed_audit');
    childGr.addQuery('batch_id', current.batch_id);
    childGr.addQuery('is_batch_header', 'false');
    childGr.addQuery('wiped', 'false');
    childGr.query();

    var updated = 0;
    while (childGr.next()) {
        childGr.setValue('wiped', 'true');
        try {
            childGr.update();
            updated++;
        } catch (e) {
            gs.error('[DemoSeed] Failed to mark audit entry as wiped: ' + e.message);
        }
    }

    gs.info('[DemoSeed] Auto-wipe marked ' + updated + ' audit entries for batch ' + current.batch_id);

})(current, previous);
