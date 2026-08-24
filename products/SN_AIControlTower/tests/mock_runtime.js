// Copyright (c) 2026 Vladimir Kapustin. Licensed under AGPL-3.0.
// AIControlTower — Node.js Mock Runtime for Unit Tests
// Provides GlideRecord, GlideDateTime, gs, Class mocks for testing SI logic

var fs = require('fs');
var path = require('path');

// ─── In-memory data store ───
var tables = {};
var counters = {};

function getTable(name) {
    if (!tables[name]) tables[name] = [];
    return tables[name];
}

function generateGuid() {
    return 'guid_' + Math.random().toString(36).substr(2, 12) + Date.now().toString(36);
}

// ─── GlideRecord Mock ───
function GlideRecord(tableName) {
    this._tableName = tableName;
    this._records = getTable(tableName);
    this._conditions = [];  // accumulate AND conditions
    this._filtered = [];
    this._index = -1;
    this._limit = 0;
    this._orderBy = null;
    this._current = null;
    this._isNew = false;
}

GlideRecord.prototype.initialize = function() {
    this._current = {};
    this._isNew = true;
    return this;
};

GlideRecord.prototype.addQuery = function(field, op, value) {
    if (op === undefined) { value = field; op = '='; }
    else if (value === undefined) { value = op; op = '='; }
    this._conditions.push({ field: field, op: op, value: value });
    return this;
};

GlideRecord.prototype.addEncodedQuery = function(encodedQuery) {
    var self = this;
    var conditions = encodedQuery.split('^');
    conditions.forEach(function(cond) {
        var parts = cond.split('=');
        if (parts.length === 2) {
            self._conditions.push({ field: parts[0], op: '=', value: parts[1] });
        }
    });
    return this;
};

GlideRecord.prototype.addActiveQuery = function() {
    this._conditions.push({ field: 'active', op: '!=', value: 'false' });
    return this;
};

GlideRecord.prototype.setLimit = function(n) { this._limit = n; return this; };
GlideRecord.prototype.orderBy = function(field) { this._orderBy = field; return this; };
GlideRecord.prototype.orderByDesc = function(field) { this._orderBy = '-' + field; return this; };

GlideRecord.prototype.query = function() {
    var self = this;
    this._filtered = this._records.filter(function(r) {
        return self._conditions.every(function(cond) {
            var fv = r[cond.field];
            if (cond.op === '=') return String(fv) === String(cond.value);
            if (cond.op === '!=') return String(fv) !== String(cond.value);
            if (cond.op === 'IN') return String(cond.value).split(',').some(function(v) { return String(fv) === v.trim(); });
            if (cond.op === '>=') return fv >= cond.value;
            if (cond.op === '<=') return fv <= cond.value;
            return true;
        });
    });
    if (this._orderBy) {
        var field = this._orderBy.replace('-', '');
        var desc = this._orderBy.startsWith('-');
        this._filtered.sort(function(a, b) {
            if (a[field] < b[field]) return desc ? 1 : -1;
            if (a[field] > b[field]) return desc ? -1 : 1;
            return 0;
        });
    }
    if (this._limit > 0) {
        this._filtered = this._filtered.slice(0, this._limit);
    }
    this._index = -1;
    this._queryResult = this._filtered;
    return this;
};

GlideRecord.prototype.getRowCount = function() {
    return this._queryResult ? this._queryResult.length : 0;
};

GlideRecord.prototype.next = function() {
    if (!this._queryResult) this.query();
    this._index++;
    if (this._index < this._queryResult.length) {
        this._current = this._queryResult[this._index];
        return true;
    }
    return false;
};

GlideRecord.prototype.get = function(sysId) {
    for (var i = 0; i < this._records.length; i++) {
        if (this._records[i].sys_id === sysId || this._records[i].sys_id === sysId) {
            this._current = this._records[i];
            return true;
        }
    }
    return false;
};

GlideRecord.prototype.getUniqueValue = function() {
    return this._current ? (this._current.sys_id || '') : '';
};

GlideRecord.prototype.getValue = function(field) {
    if (!this._current) return '';
    return this._current[field] !== undefined ? String(this._current[field]) : '';
};

GlideRecord.prototype.setValue = function(field, value) {
    if (!this._current) this._current = {};
    this._current[field] = String(value);
    return this;
};

GlideRecord.prototype.insert = function() {
    if (!this._current) return null;
    var sysId = this._current.sys_id || generateGuid();
    this._current.sys_id = sysId;
    this._records.push(this._current);
    this._isNew = false;
    return sysId;
};

GlideRecord.prototype.update = function() {
    // In mock, records are already in array; no-op
    return this._current ? this._current.sys_id : null;
};

GlideRecord.prototype.isValidField = function(field) {
    return true; // mock allows all fields
};

// ─── GlideDateTime Mock ───
function GlideDateTime(dtStr) {
    if (dtStr) {
        // Handle "YYYY-MM-DD HH:MM:SS" format
        var normalized = String(dtStr).replace(' ', 'T');
        this._date = new Date(normalized);
        if (isNaN(this._date.getTime())) this._date = new Date(dtStr);
    } else {
        this._date = new Date();
    }
}

GlideDateTime.prototype.getNumericValue = function() {
    return this._date.getTime();
};

GlideDateTime.prototype.getDisplayValue = function() {
    return this._date.toISOString().replace('T', ' ').substr(0, 19);
};

GlideDateTime.prototype.addDaysUTC = function(days) {
    this._date.setDate(this._date.getDate() + days);
    return this;
};

// ─── gs Mock ───
var gs = {
    getUserID: function() { return 'test_user_sysid'; },
    nowDateTime: function() { return new Date().toISOString().replace('T', ' ').substr(0, 19); },
    generateGUID: function() { return generateGuid(); },
    log: function(msg, source) { console.log('[' + (source || 'GS') + '] ' + msg); },
    getProperty: function(key, def) { return def; },
    hasRole: function(role) { return false; }
};

// ─── Class Mock ───
var Class = {
    create: function() {
        function Cls() {
            if (this.initialize) this.initialize.apply(this, arguments);
        }
        Cls.prototype = {};
        return Cls;
    }
};

// ─── Load and expose Script Includes ───
function loadScriptInclude(filePath) {
    var code = fs.readFileSync(filePath, 'utf8');
    // Create a function scope with mocked globals
    var fn = new Function('GlideRecord', 'GlideDateTime', 'gs', 'Class', code);
    fn(GlideRecord, GlideDateTime, gs, Class);
    // Class.create() puts constructors in this scope — need to capture from global
    return fn;
}

// ─── Test Data Helpers ───
function seedTable(tableName, records) {
    tables[tableName] = records.map(function(r) {
        r.sys_id = r.sys_id || generateGuid();
        return r;
    });
}

function resetTables() {
    tables = {};
    counters = {};
}

module.exports = {
    GlideRecord: GlideRecord,
    GlideDateTime: GlideDateTime,
    gs: gs,
    Class: Class,
    loadScriptInclude: loadScriptInclude,
    seedTable: seedTable,
    resetTables: resetTables,
    getTable: getTable,
    tables: tables,
    generateGuid: generateGuid
};