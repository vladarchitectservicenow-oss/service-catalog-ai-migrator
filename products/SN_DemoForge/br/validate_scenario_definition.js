// DemoForge — Realistic Demo & Test Data Generator for ServiceNow
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Business Rule: Validate scenario definition JSON on insert/update.
// Prevents malformed scenario schemas from entering the registry.
(function executeRule(current, previous /*null when async*/) {
    var def = current.getValue('definition');
    if (!def) {
        gs.addErrorMessage('DemoForge: scenario definition is required.');
        current.setAbortAction(true);
        return;
    }
    try {
        var parsed = JSON.parse(def);
        if (!parsed.name || !parsed.tables) {
            gs.addErrorMessage('DemoForge: scenario definition must include "name" and "tables".');
            current.setAbortAction(true);
            return;
        }
    } catch (e) {
        gs.addErrorMessage('DemoForge: scenario definition is not valid JSON: ' + e);
        current.setAbortAction(true);
    }
})(current, previous);
