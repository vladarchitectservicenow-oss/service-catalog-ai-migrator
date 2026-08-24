// ScriptInclude Medic — Scheduled Scan (scheduled job script)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Daily incremental scan. Falls back to a full scan when the include set has
// changed since the last completed run.

(function runScheduledScan() {
    try {
        var runner = new SimMedicRunner();
        var incremental = false;
        if (runner.hasChangedSinceLastScan()) {
            incremental = false;
        } else {
            incremental = true;
        }
        var summary = runner.runScan(incremental, null);
        gs.info('SimMedic scheduled scan complete: health=' + summary.instance_health +
            ', includes=' + summary.include_count +
            ', dead=' + summary.dead_count +
            ', duplicates=' + summary.duplicate_count);
    } catch (e) {
        gs.error('SimMedic scheduled scan failed: ' + e.message);
    }
})();
