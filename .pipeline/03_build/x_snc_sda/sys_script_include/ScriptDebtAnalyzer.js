var ScriptDebtAnalyzer = Class.create();
ScriptDebtAnalyzer.prototype = {
    initialize: function() {
        this.RISK_RULES = [
            {
                id: 'R001',
                name: 'Global Scope Abuse',
                pattern: /new\s+GlideRecord\s*\(\s*['"]([a-z0-9_]+)['"]\s*\)/g,
                severity: 'HIGH',
                description: 'Script uses GlideRecord without explicit scope reference; may indicate global scope abuse.',
                remediation: 'Wrap GlideRecord usage in scoped functions or use GlideQuery for read-only access.'
            },
            {
                id: 'R002',
                name: 'Hardcoded sys_id',
                pattern: /['"][a-f0-9]{32}['"]/g,
                severity: 'CRITICAL',
                description: 'Hardcoded 32-character hexadecimal sys_id detected.',
                remediation: 'Replace with configuration records (sys_properties) or dynamic lookups.'
            },
            {
                id: 'R003',
                name: 'Unparameterized Query',
                pattern: /addQuery\s*\(\s*['"][a-z0-9_]+['"]\s*,\s*['"][^'"]+['"]\s*\)/g,
                severity: 'HIGH',
                description: 'addQuery with literal value may be safe, but concatenation is risky.',
                remediation: 'Always parameterize dynamic query parts using setValue with type checking.'
            },
            {
                id: 'R004',
                name: 'eval() usage',
                pattern: /\beval\s*\(/g,
                severity: 'CRITICAL',
                description: 'eval() enables arbitrary code execution.',
                remediation: 'Remove eval(). Use JSON.parse for JSON strings or structured parsers.'
            },
            {
                id: 'R005',
                name: 'Insecure HTTP endpoint',
                pattern: /http:\/\//g,
                severity: 'MEDIUM',
                description: 'Non-HTTPS endpoint detected in script.',
                remediation: 'Enforce HTTPS for all external communications.'
            },
            {
                id: 'R006',
                name: 'Legacy GlideAjax pattern',
                pattern: /GlideAjax\s*\(/g,
                severity: 'LOW',
                description: 'GlideAjax is legacy; consider scripted REST API or data resources.',
                remediation: 'Migrate to Scripted REST API or Service Portal data sources.'
            },
            {
                id: 'R007',
                name: 'gs.print / gs.log in production',
                pattern: /\bgs\.(print|log)\s*\(/g,
                severity: 'MEDIUM',
                description: 'Debug logging left in production code impacts performance.',
                remediation: 'Replace with structured gs.info/gs.warn/gs.error or remove debug logs.'
            },
            {
                id: 'R008',
                name: 'Direct SQL via GlideRecordUnsafe',
                pattern: /GlideRecordUnsafe|executeQuery\s*\(/gi,
                severity: 'CRITICAL',
                description: 'Potential direct SQL execution detected.',
                remediation: 'Use standard GlideRecord API with proper ACL checks.'
            }
        ];
    },

    /**
     * Analyze a single script include or business rule.
     * @param {string} sysId — sys_id из sys_script_include или sys_script
     * @param {string} table — 'sys_script_include' или 'sys_script'
     * @return {Object} scan result
     */
    analyzeScript: function(sysId, table) {
        var gr = new GlideRecord(table);
        if (!gr.get(sysId)) return { error: 'Record not found' };

        var scriptBody = gr.getValue('script') || '';
        var findings = [];
        var score = 100;

        for (var i = 0; i < this.RISK_RULES.length; i++) {
            var rule = this.RISK_RULES[i];
            var matches = [];
            // Reset regex lastIndex for global patterns
            rule.pattern.lastIndex = 0;
            var match;
            while ((match = rule.pattern.exec(scriptBody)) !== null) {
                matches.push({
                    line: this._getLineNumber(scriptBody, match.index),
                    snippet: scriptBody.substring(Math.max(0, match.index - 20), match.index + match[0].length + 20)
                });
            }

            if (matches.length > 0) {
                var penalty = rule.severity === 'CRITICAL' ? 20 : rule.severity === 'HIGH' ? 10 : rule.severity === 'MEDIUM' ? 5 : 2;
                score -= (penalty * matches.length);
                findings.push({
                    rule_id: rule.id,
                    rule_name: rule.name,
                    severity: rule.severity,
                    description: rule.description,
                    remediation: rule.remediation,
                    matches: matches
                });
            }
        }

        score = Math.max(0, score);

        return {
            sys_id: sysId,
            table: table,
            name: gr.getValue('name'),
            api_name: gr.getValue('api_name') || '',
            scope: gr.getValue('sys_scope.scope') || gr.getValue('sys_scope') || 'global',
            score: score,
            state: score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'critical',
            findings_count: findings.length,
            findings: findings,
            script_length: scriptBody.length,
            lines_of_code: this._countLines(scriptBody),
            scanned_on: new GlideDateTime().toString()
        };
    },

    /**
     * Batch analyze all script includes and business rules.
     * @return {Object} { total, scripts, score_avg }
     */
    analyzeAll: function() {
        var results = [];
        var totalScore = 0;
        var tables = ['sys_script_include', 'sys_script'];
        for (var t = 0; t < tables.length; t++) {
            var table = tables[t];
            var gr = new GlideRecord(table);
            gr.query();
            while (gr.next()) {
                var res = this.analyzeScript(gr.getValue('sys_id'), table);
                results.push(res);
                totalScore += res.score;
                this._persistResult(res);
            }
        }
        return {
            total: results.length,
            score_avg: results.length > 0 ? Math.round(totalScore / results.length) : 0,
            scripts: results
        };
    },

    _persistResult: function(res) {
        var gr = new GlideRecord('x_snc_sda_script_scan');
        gr.initialize();
        gr.script_record = res.sys_id;
        gr.script_table = res.table;
        gr.script_name = res.name;
        gr.script_scope = res.scope;
        gr.score = res.score;
        gr.state = res.state;
        gr.findings_json = JSON.stringify(res.findings);
        gr.script_length = res.script_length;
        gr.lines_of_code = res.lines_of_code;
        gr.scanned_on = new GlideDateTime();
        gr.insert();
    },

    _getLineNumber: function(text, index) {
        var lines = text.substring(0, index).split('\n');
        return lines.length;
    },

    _countLines: function(text) {
        return text.split('\n').length;
    },

    type: 'ScriptDebtAnalyzer'
};
