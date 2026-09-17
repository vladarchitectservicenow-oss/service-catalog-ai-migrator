// RoleHygiene — RoleHygieneEngine
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Deterministic entitlement-drift audit engine. Pure GlideRecord + business
// logic — no AI, no side effects. Every finding produced here is reproducible
// and defensible under audit. All detection methods return plain objects that
// the manager layer persists to the finding table.
//
// @class RoleHygieneEngine @namespace x_snc_role_hygiene
var RoleHygieneEngine = Class.create();
RoleHygieneEngine.prototype = {

    initialize: function () {
        this.OOTB_USER_TABLE = 'sys_user';
        this.OOTB_ROLE_TABLE = 'sys_user_has_role';
    },

    /**
     * Detect dormant accounts: active users whose last_login_time is older than
     * thresholdDays (or NULL). Cross-references open incidents/requests/approvals
     * to suppress false positives ("still owns open tickets — don't flag").
     *
     * @param {number} thresholdDays - inactivity threshold in days
     * @returns {Array} list of { user_sys_id, user_name, last_login, days_inactive,
     *                            has_roles, open_ticket_count, risk_class }
     */
    detectDormantAccounts: function (thresholdDays) {
        var cutoff = new GlideDateTime();
        cutoff.addDaysLocalTime(-1 * thresholdDays);

        var findings = [];
        var gr = new GlideRecord(this.OOTB_USER_TABLE);
        gr.addActiveQuery();
        gr.query();

        while (gr.next()) {
            var userId = gr.getUniqueValue();
            var lastLoginRaw = gr.getValue('last_login_time');

            var dormant = false;
            var daysInactive = -1;
            if (lastLoginRaw) {
                var lastLogin = new GlideDateTime(lastLoginRaw);
                if (lastLogin.before(cutoff)) {
                    dormant = true;
                    daysInactive = this._daysBetween(lastLogin, new GlideDateTime());
                }
            } else {
                // NULL last_login with no login history — treat as dormant
                dormant = true;
            }

            if (!dormant) {
                continue;
            }

            // Cross-reference open work to suppress false positives.
            var openTickets = this._countOpenTickets(userId);
            if (openTickets > 0) {
                continue;
            }

            var hasRoles = this._userHasAnyRole(userId);
            var riskClass = hasRoles ? 'security-risk' : 'license-waste';

            findings.push({
                user_sys_id: userId,
                user_name: gr.getValue('user_name'),
                last_login: lastLoginRaw || '',
                days_inactive: daysInactive,
                has_roles: hasRoles,
                open_ticket_count: openTickets,
                risk_class: riskClass
            });
        }

        return findings;
    },

    /**
     * Analyze privilege creep by comparing the current entitlement set against a
     * prior snapshot. Reports monotonic role accumulation and per-department
     * outliers.
     *
     * @param {Array} currentEntitlements - [{ user_sys_id, role_sys_id, role_name, department }]
     * @param {Array} priorSnapshot - [{ user_sys_id, role_sys_id }] from a previous capture
     * @returns {Array} list of { user_sys_id, user_name, added_roles, department, outlier }
     */
    analyzeCreep: function (currentEntitlements, priorSnapshot) {
        if (!priorSnapshot || priorSnapshot.length === 0) {
            return []; // no baseline yet — first snapshot is a seed, not a finding
        }

        var priorIndex = {};
        for (var i = 0; i < priorSnapshot.length; i++) {
            var p = priorSnapshot[i];
            priorIndex[p.user_sys_id + ':' + p.role_sys_id] = true;
        }

        var additions = {};
        var order = [];
        for (var j = 0; j < currentEntitlements.length; j++) {
            var c = currentEntitlements[j];
            var key = c.user_sys_id + ':' + c.role_sys_id;
            if (!priorIndex[key]) {
                if (!additions[c.user_sys_id]) {
                    additions[c.user_sys_id] = {
                        user_sys_id: c.user_sys_id,
                        user_name: c.user_name || '',
                        department: c.department || '',
                        added_roles: [],
                        outlier: false
                    };
                    order.push(c.user_sys_id);
                }
                additions[c.user_sys_id].added_roles.push(c.role_name || c.role_sys_id);
            }
        }

        // Per-department outlier: flag users who accumulated roles far above the
        // department median of additions.
        var deptCounts = {};
        for (var k = 0; k < order.length; k++) {
            var rec = additions[order[k]];
            var dept = rec.department || '(none)';
            if (!deptCounts[dept]) {
                deptCounts[dept] = [];
            }
            deptCounts[dept].push(rec.added_roles.length);
        }

        var result = [];
        for (var m = 0; m < order.length; m++) {
            var rec2 = additions[order[m]];
            var dept2 = rec2.department || '(none)';
            var counts = deptCounts[dept2];
            var median = this._median(counts);
            rec2.outlier = (rec2.added_roles.length > median + 2);
            result.push(rec2);
        }

        return result;
    },

    /**
     * Segregation-of-Duties engine: for each conflict pair, find users holding
     * both ends. Ranks results by blast radius (number of SoD pairs violated +
     * whether the user is privileged).
     *
     * @param {Array} sodRules - [{ name, role_a_sys_id, role_b_sys_id, description }]
     * @param {Array} entitlements - [{ user_sys_id, role_sys_id }]
     * @returns {Array} list of { user_sys_id, user_name, violated_pairs, blast_radius }
     */
    findSodConflicts: function (sodRules, entitlements) {
        if (!sodRules || sodRules.length === 0) {
            return [];
        }

        // Build user -> set of role sys_ids (includes direct roles).
        var userRoles = {};
        for (var i = 0; i < entitlements.length; i++) {
            var e = entitlements[i];
            if (!userRoles[e.user_sys_id]) {
                userRoles[e.user_sys_id] = {};
            }
            userRoles[e.user_sys_id][e.role_sys_id] = true;
        }

        var violations = {};
        var userNames = {};
        var order = [];
        for (var j = 0; j < entitlements.length; j++) {
            var en = entitlements[j];
            if (userNames[en.user_sys_id] === undefined) {
                userNames[en.user_sys_id] = en.user_name || '';
            }
        }

        for (var r = 0; r < sodRules.length; r++) {
            var rule = sodRules[r];
            for (var uid in userRoles) {
                if (!userRoles.hasOwnProperty(uid)) {
                    continue;
                }
                var roles = userRoles[uid];
                if (roles[rule.role_a_sys_id] && roles[rule.role_b_sys_id]) {
                    if (!violations[uid]) {
                        violations[uid] = [];
                        order.push(uid);
                    }
                    violations[uid].push(rule.name || (rule.role_a_sys_id + ' ↔ ' + rule.role_b_sys_id));
                }
            }
        }

        var result = [];
        for (var q = 0; q < order.length; q++) {
            var userId = order[q];
            var pairCount = violations[userId].length;
            var totalRoles = 0;
            for (var kk in userRoles[userId]) {
                if (userRoles[userId].hasOwnProperty(kk)) {
                    totalRoles++;
                }
            }
            result.push({
                user_sys_id: userId,
                user_name: userNames[userId] || '',
                violated_pairs: violations[userId],
                blast_radius: pairCount * 10 + totalRoles
            });
        }

        // Rank by blast radius descending.
        result.sort(function (a, b) {
            return b.blast_radius - a.blast_radius;
        });

        return result;
    },

    /**
     * Compute a drift score (0-100, higher = riskier) for a user given the counts
     * of dormant flags, creep additions, and SoD violations.
     *
     * @param {object} stats - { dormant:number, creep_added:number, sod_violations:number }
     * @returns {number} 0-100 drift score
     */
    scoreDrift: function (stats) {
        var score = 0;
        score += (stats.dormant ? 20 : 0);
        score += Math.min(stats.creep_added || 0, 5) * 8;
        score += Math.min(stats.sod_violations || 0, 5) * 12;
        return Math.min(score, 100);
    },

    // ---- private helpers -------------------------------------------------

    _countOpenTickets: function (userId) {
        var count = 0;
        var tables = ['incident', 'sc_request', 'change_request', 'sysapproval_approver'];
        for (var i = 0; i < tables.length; i++) {
            var gr = new GlideRecord(tables[i]);
            if (tables[i] === 'sysapproval_approver') {
                gr.addQuery('approver', userId);
                gr.addQuery('state', 'requested');
            } else {
                gr.addQuery('caller_id', userId);
                gr.addActiveQuery();
            }
            gr.setLimit(1);
            gr.query();
            count += gr.getRowCount();
        }
        return count;
    },

    _userHasAnyRole: function (userId) {
        var gr = new GlideRecord(this.OOTB_ROLE_TABLE);
        gr.addQuery('user', userId);
        gr.setLimit(1);
        gr.query();
        return gr.hasNext();
    },

    _daysBetween: function (earlier, later) {
        var ms = later.getNumericValue() - earlier.getNumericValue();
        return Math.floor(ms / 86400000);
    },

    _median: function (values) {
        var sorted = values.slice().sort(function (a, b) {
            return a - b;
        });
        var mid = Math.floor(sorted.length / 2);
        if (sorted.length % 2 === 0) {
            return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
        }
        return sorted[mid];
    },

    type: 'RoleHygieneEngine'
};
