var CatalogPatternClassifier = Class.create();
CatalogPatternClassifier.prototype = {
    initialize: function() {
        this.PATTERNS = {
            APPROVAL: ['approval', 'approve', 'manager', 'supervisor', 'sign off'],
            PROVISIONING: ['provision', 'create', 'deploy', 'license', 'account', 'vm', 'laptop'],
            NOTIFICATION: ['notify', 'email', 'slack', 'alert', 'remind'],
            ESCALATION: ['escalate', 'escalation', 'timeout', 'breach', 'missed sla']
        };
        this.PATTERN_THRESHOLDS = { APPROVAL: 2, PROVISIONING: 2, NOTIFICATION: 2, ESCALATION: 2 };
    },

    /**
     * Classify a catalog item into workflow pattern buckets.
     * @param {GlideRecord} catItemGR — sc_cat_item record
     * @return {Object} { primaryPattern, scores, confidence }
     */
    classifyItem: function(catItemGR) {
        var text = (catItemGR.short_description + ' ' + catItemGR.description + ' ' + catItemGR.name).toLowerCase();
        var scores = {};
        for (var pattern in this.PATTERNS) {
            var keywords = this.PATTERNS[pattern];
            var score = 0;
            for (var i = 0; i < keywords.length; i++) {
                if (text.indexOf(keywords[i]) > -1) score++;
            }
            scores[pattern] = score;
        }
        var primaryPattern = this._getPrimaryPattern(scores);
        return {
            primaryPattern: primaryPattern,
            scores: scores,
            confidence: this._calculateConfidence(scores, primaryPattern)
        };
    },

    /**
     * Batch-classify all active catalog items.
     * @return {Array} [{ sys_id, name, primaryPattern, confidence }]
     */
    classifyAll: function() {
        var results = [];
        var gr = new GlideRecord('sc_cat_item');
        gr.addActiveQuery();
        gr.query();
        while (gr.next()) {
            var classification = this.classifyItem(gr);
            results.push({
                sys_id: gr.getValue('sys_id'),
                name: gr.getValue('name'),
                primaryPattern: classification.primaryPattern,
                confidence: classification.confidence,
                scores: classification.scores
            });
        }
        return results;
    },

    _getPrimaryPattern: function(scores) {
        var best = 'UNKNOWN';
        var bestScore = -1;
        for (var pattern in scores) {
            if (scores[pattern] > bestScore && scores[pattern] >= this.PATTERN_THRESHOLDS[pattern]) {
                bestScore = scores[pattern];
                best = pattern;
            }
        }
        return best;
    },

    _calculateConfidence: function(scores, primary) {
        if (primary === 'UNKNOWN') return 0;
        var total = 0;
        for (var k in scores) total += scores[k];
        return total === 0 ? 0 : Math.round((scores[primary] / total) * 100);
    },

    type: 'CatalogPatternClassifier'
};
