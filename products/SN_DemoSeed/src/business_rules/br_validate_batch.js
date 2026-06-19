// DemoSeed — BR1: Validate Batch Before Insert
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Table: x_demoseed_audit
// When: before insert
// Order: 100

(function executeRule(current, previous /*null when async*/) {
    // Only validate batch header records
    if (current.is_batch_header !== 'true') return;

    // Production guard
    if (gs.getProperty('glide.installation.production', 'false') === 'true' &&
        gs.getProperty('x_demoseed.override_prod', 'false') !== 'true') {
        current.setAbortAction(true);
        gs.addErrorMessage('DemoSeed cannot run on production instances. Set x_demoseed.override_prod=true to override.');
        return;
    }

    // Validate batch_id is present
    if (!current.batch_id) {
        current.setAbortAction(true);
        gs.addErrorMessage('Batch ID is required.');
        return;
    }

    // Validate status is a valid choice
    var validStatuses = ['pending', 'running', 'complete', 'failed', 'wiped'];
    if (validStatuses.indexOf(current.status + '') === -1) {
        current.setAbortAction(true);
        gs.addErrorMessage('Invalid status: ' + current.status + '. Must be one of: ' + validStatuses.join(', '));
        return;
    }

    // Set started_on if not provided
    if (!current.started_on) {
        current.started_on = new GlideDateTime().getValue();
    }

})(current, previous);
