/**
 * Copyright (c) 2026 Vladimir Kapustin
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Scheduled Job: USI Pre-Clone Backup
 * Runs daily at 02:00 (configurable via system property)
 * Backs up all in-progress update sets as XML attachments
 * and sends notification email.
 *
 * System properties:
 *   x_usi_inspector.pre_clone_backup_enabled  — true/false (default: true)
 *   x_usi_inspector.pre_clone_backup_group    — group sys_id for notifications
 *   x_usi_inspector.pre_clone_schedule        — cron expression (default: 0 2 * * *)
 */
var USIPreCloneBackup = Class.create();
USIPreCloneBackup.prototype = {
    initialize: function() {},

    execute: function() {
        // Check if backup is enabled
        var enabled = gs.getProperty('x_usi_inspector.pre_clone_backup_enabled', 'true');
        if (enabled !== 'true') {
            gs.log('USI Pre-Clone Backup: disabled by system property, skipping', 'USI');
            return;
        }

        gs.log('USI Pre-Clone Backup: starting backup of all in-progress update sets', 'USI');
        var backupMgr = new USIBackupManager();
        var result = backupMgr.backupAllInProgress();

        if (result.ok) {
            gs.log('USI Pre-Clone Backup: completed successfully. ' + result.count + ' update set(s) backed up.', 'USI');
        } else {
            gs.logError('USI Pre-Clone Backup: FAILED. Error: ' + (result.error || 'unknown'), 'USI');
        }
    },

    type: 'USIPreCloneBackup'
};

// Execute the scheduled job
var job = new USIPreCloneBackup();
job.execute();