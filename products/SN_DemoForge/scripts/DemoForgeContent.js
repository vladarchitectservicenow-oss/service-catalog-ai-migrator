// DemoForge — Realistic Demo & Test Data Generator for ServiceNow
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// DemoForgeContent — deterministic, faker-style content generation.
// Produces realistic names, titles, departments, locations, vendor/model
// strings, and natural-language short descriptions / resolution notes.
// No GenAI Controller dependency: weighted template pools + variation.
// @class DemoForgeContent @namespace x_demo_forge
var DemoForgeContent = Class.create();
DemoForgeContent.prototype = {
    initialize: function(seed) {
        // Optional seed for reproducible runs. When omitted, uses Math.random().
        this._seed = seed || 0;
        this._state = this._seed;
    },

    // ---- Seeded PRNG (LCG) ----
    _next: function() {
        // Numerical Recipes LCG — deterministic when seeded, random otherwise.
        this._state = (this._state * 1664525 + 1013904223) % 4294967296;
        return this._state / 4294967296;
    },

    _rand: function() {
        if (this._seed) {
            return this._next();
        }
        return Math.random();
    },

    _pick: function(arr) {
        return arr[Math.floor(this._rand() * arr.length)];
    },

    _int: function(min, max) {
        return min + Math.floor(this._rand() * (max - min + 1));
    },

    // ---- Name pools ----
    _firstNames: ['James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
        'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
        'Thomas', 'Sarah', 'Charles', 'Karen', 'Daniel', 'Nancy', 'Matthew', 'Lisa', 'Anthony',
        'Betty', 'Mark', 'Margaret', 'Donald', 'Sandra', 'Steven', 'Ashley', 'Paul', 'Kimberly',
        'Andrew', 'Emily', 'Joshua', 'Donna', 'Kenneth', 'Michelle', 'Kevin', 'Carol', 'Brian',
        'Amanda', 'George', 'Dorothy', 'Timothy', 'Melissa', 'Ronald', 'Deborah', 'Edward',
        'Stephanie', 'Jason', 'Rebecca', 'Jeffrey', 'Sharon', 'Ryan', 'Laura', 'Jacob', 'Cynthia',
        'Gary', 'Kathleen', 'Nicholas', 'Amy', 'Eric', 'Angela', 'Jonathan', 'Helen', 'Stephen',
        'Anna', 'Larry', 'Brenda', 'Justin', 'Pamela', 'Scott', 'Nicole', 'Brandon', 'Samantha',
        'Benjamin', 'Katherine', 'Samuel', 'Emma', 'Gregory', 'Ruth', 'Alexander', 'Christine',
        'Frank', 'Catherine', 'Patrick', 'Debra', 'Raymond', 'Rachel', 'Jack', 'Carolyn', 'Dennis',
        'Janet', 'Jerry', 'Virginia', 'Tyler', 'Maria', 'Aaron', 'Heather', 'Jose', 'Diane'],

    _lastNames: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
        'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas',
        'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris',
        'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King',
        'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams', 'Nelson',
        'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts', 'Gomez', 'Phillips',
        'Evans', 'Turner', 'Diaz', 'Parker', 'Cruz', 'Edwards', 'Collins', 'Reyes', 'Stewart',
        'Morris', 'Morales', 'Murphy', 'Cook', 'Rogers', 'Gutierrez', 'Ortiz', 'Morgan', 'Cooper',
        'Peterson', 'Bailey', 'Reed', 'Kelly', 'Howard', 'Ramos', 'Kim', 'Cox', 'Ward',
        'Richardson', 'Watson', 'Brooks', 'Chavez', 'Wood', 'James', 'Bennett', 'Gray', 'Mendoza',
        'Ruiz', 'Hughes', 'Price', 'Alvarez', 'Castillo', 'Sanders', 'Patel', 'Myers', 'Long',
        'Ross', 'Foster', 'Jimenez'],

    _titles: ['IT Support Specialist', 'Systems Administrator', 'Network Engineer', 'Database Administrator',
        'Help Desk Analyst', 'Service Desk Manager', 'IT Operations Manager', 'Security Analyst',
        'Security Engineer', 'Cloud Architect', 'DevOps Engineer', 'Application Developer',
        'Business Analyst', 'Project Manager', 'IT Director', 'Chief Information Officer',
        'Infrastructure Engineer', 'Desktop Support Technician', 'IT Asset Manager', 'Change Manager',
        'Incident Manager', 'Problem Manager', 'Release Manager', 'Compliance Officer',
        'Data Analyst', 'QA Engineer', 'Site Reliability Engineer', 'IT Procurement Specialist'],

    _departments: ['IT Operations', 'Information Security', 'Application Development', 'Infrastructure',
        'Service Desk', 'Network Engineering', 'Database Administration', 'Cloud Services',
        'IT Service Management', 'Compliance & Risk', 'Project Management Office', 'End User Computing',
        'Data & Analytics', 'Quality Assurance', 'IT Procurement', 'Executive Leadership'],

    _locations: ['New York, NY', 'San Francisco, CA', 'Austin, TX', 'Chicago, IL', 'Seattle, WA',
        'Boston, MA', 'Atlanta, GA', 'Denver, CO', 'Dallas, TX', 'Los Angeles, CA', 'Miami, FL',
        'Philadelphia, PA', 'Phoenix, AZ', 'Portland, OR', 'Minneapolis, MN', 'Washington, DC',
        'Toronto, ON', 'London, UK', 'Berlin, DE', 'Singapore', 'Sydney, AU', 'Tokyo, JP'],

    _vendors: ['Dell', 'HP', 'Lenovo', 'Apple', 'Cisco', 'Juniper', 'Arista', 'Fortinet', 'Palo Alto',
        'Microsoft', 'IBM', 'Oracle', 'NetApp', 'EMC', 'Pure Storage', 'Supermicro', 'HPE',
        'Ubiquiti', 'F5', 'Check Point'],

    _serverModels: ['PowerEdge R740', 'PowerEdge R750', 'ProLiant DL380 Gen10', 'ProLiant DL360 Gen11',
        'ThinkSystem SR650', 'ThinkSystem SR630', 'UCS C220 M6', 'UCS B200 M5', 'Mac Pro 7,1',
        'Supermicro SYS-1029P', 'PowerEdge R650xs', 'ProLiant DL325 Gen10'],

    _laptopModels: ['Latitude 5520', 'Latitude 7420', 'ThinkPad X1 Carbon', 'ThinkPad T14', 'EliteBook 840 G8',
        'EliteBook 850 G8', 'MacBook Pro 14', 'MacBook Air M2', 'Precision 5560', 'ThinkPad P15'],

    _networkModels: ['Catalyst 9300', 'Catalyst 9500', 'Nexus 9000', 'EX4300', 'QFX5120', 'FortiGate 200F',
        'PA-5250', 'ASA 5525-X', 'ISR 4451', 'ASR 1002-X'],

    _incidentCategories: ['Hardware', 'Software', 'Network', 'Email', 'Access', 'Database', 'Security',
        'Printing', 'VPN', 'Mobile Device'],

    _incidentTemplates: [
        'Unable to access {app} — {symptom}',
        '{app} is running slowly for {who}',
        'Cannot connect to {resource} from {location}',
        'Password reset required for {app}',
        '{device} will not power on',
        'Email not syncing on {device}',
        'VPN connection drops every {minutes} minutes',
        'Printer {printer} is offline',
        '{app} crashes when {action}',
        'Requesting access to {resource}',
        'Software installation failed on {device}',
        'Network drive {drive} is not accessible'
    ],

    _symptoms: ['showing a blank screen', 'returning a 500 error', 'timing out after 30 seconds',
        'displaying an authentication error', 'freezing on startup', 'throwing an unexpected exception',
        'not responding to input', 'showing stale data', 'failing to load modules'],

    _apps: ['ServiceNow', 'Outlook', 'Salesforce', 'SAP', 'Jira', 'Confluence', 'SharePoint', 'Teams',
        'Slack', 'Workday', 'Oracle ERP', 'Active Directory', 'Citrix', 'Zoom'],

    _resources: ['the file server', 'the intranet portal', 'the CRM database', 'the VPN gateway',
        'the shared drive', 'the print server', 'the HR system', 'the finance application'],

    _devices: ['laptop', 'desktop', 'workstation', 'tablet', 'thin client'],

    _printers: ['PRN-FL2-01', 'PRN-FL3-04', 'PRN-FL1-02', 'PRN-B1-07', 'PRN-FL4-11'],

    _actions: ['opening a new record', 'saving a form', 'running a report', 'exporting data',
        'attaching a file', 'submitting a request', 'approving a change'],

    _drives: ['H:', 'S:', 'P:', 'T:', 'U:'],

    _resolutionTemplates: [
        'Rebooted the {device} and verified the issue was resolved. {followup}',
        'Cleared the cached credentials and re-authenticated the user. {followup}',
        'Applied the latest patch to {app} and confirmed normal operation. {followup}',
        'Re-provisioned access to {resource} after verifying the request. {followup}',
        'Replaced the faulty {component} and ran diagnostics to confirm. {followup}',
        'Reset the {app} configuration to the known-good baseline. {followup}',
        'Escalated to the {team} team; they resolved the underlying {cause}. {followup}',
        'Updated the {app} client to the latest version. {followup}',
        'Restarted the affected service and monitored for 30 minutes. {followup}',
        'Re-imaged the {device} and restored the user profile. {followup}'
    ],

    _followups: ['No further issues reported.', 'User confirmed the issue is resolved.',
        'Monitoring for recurrence over the next 24 hours.', 'Closed after user confirmation.',
        'Added a knowledge article to prevent recurrence.', 'Documented the root cause for the team.'],

    _components: ['power supply', 'network card', 'hard drive', 'memory module', 'display panel',
        'keyboard', 'battery', 'motherboard'],

    _teams: ['network', 'database', 'security', 'application', 'infrastructure', 'vendor support'],

    _causes: ['configuration drift', 'expired certificate', 'failed update', 'resource exhaustion',
        'misconfigured policy', 'corrupted profile'],

    _kbTitles: [
        'How to reset your {app} password',
        'Troubleshooting {app} connectivity issues',
        'Setting up VPN access on {device}',
        'Common {app} error messages and fixes',
        'Requesting access to {resource}',
        'Best practices for {app} performance',
        'How to map a network drive on {device}',
        'Recovering deleted files from {resource}'
    ],

    // ---- Public API ----
    getName: function() {
        return this._pick(this._firstNames) + ' ' + this._pick(this._lastNames);
    },

    getTitle: function() {
        return this._pick(this._titles);
    },

    getDepartment: function() {
        return this._pick(this._departments);
    },

    getLocation: function() {
        return this._pick(this._locations);
    },

    /**
     * Map a location string ("New York, NY" / "Singapore") to a country code.
     * US entries carry a state code in the second segment; international
     * entries carry a country code. Returns a proper ISO country code.
     */
    getCountry: function(location) {
        var parts = (location || '').split(',');
        if (parts.length < 2) {
            // No comma: single-token international city.
            var city = (parts[0] || '').trim();
            if (city === 'Singapore') { return 'SG'; }
            if (city === 'Tokyo') { return 'JP'; }
            return 'US';
        }
        var code = parts[1].trim();
        // US state codes (2 uppercase letters) map to US.
        if (/^[A-Z]{2}$/.test(code) && code !== 'UK' && code !== 'DE' && code !== 'AU' && code !== 'JP') {
            return 'US';
        }
        return code;
    },

    getVendor: function() {
        return this._pick(this._vendors);
    },

    getServerModel: function() {
        return this._pick(this._serverModels);
    },

    getLaptopModel: function() {
        return this._pick(this._laptopModels);
    },

    getNetworkModel: function() {
        return this._pick(this._networkModels);
    },

    getEmail: function(firstName, lastName) {
        var f = (firstName || 'user').toLowerCase().replace(/[^a-z]/g, '');
        var l = (lastName || 'user').toLowerCase().replace(/[^a-z]/g, '');
        return f + '.' + l + '@' + this._pick(['acme.com', 'globex.com', 'initech.com', 'umbrella.com', 'stark.com']);
    },

    getPhone: function() {
        return '+1 (' + this._int(200, 989) + ') ' + this._int(200, 989) + '-' + this._int(1000, 9999);
    },

    getShortDescription: function(category) {
        var t = this._pick(this._incidentTemplates);
        return t
            .replace('{app}', this._pick(this._apps))
            .replace('{symptom}', this._pick(this._symptoms))
            .replace('{who}', this._pick(['the user', 'multiple users', 'the finance team', 'remote staff', 'new hires']))
            .replace('{resource}', this._pick(this._resources))
            .replace('{location}', this._pick(this._locations))
            .replace('{device}', this._pick(this._devices))
            .replace('{minutes}', String(this._int(5, 60)))
            .replace('{printer}', this._pick(this._printers))
            .replace('{action}', this._pick(this._actions))
            .replace('{drive}', this._pick(this._drives));
    },

    getResolutionNotes: function() {
        var t = this._pick(this._resolutionTemplates);
        return t
            .replace('{device}', this._pick(this._devices))
            .replace('{app}', this._pick(this._apps))
            .replace('{resource}', this._pick(this._resources))
            .replace('{component}', this._pick(this._components))
            .replace('{team}', this._pick(this._teams))
            .replace('{cause}', this._pick(this._causes))
            .replace('{followup}', this._pick(this._followups));
    },

    getKbTitle: function() {
        return this._pick(this._kbTitles)
            .replace('{app}', this._pick(this._apps))
            .replace('{device}', this._pick(this._devices))
            .replace('{resource}', this._pick(this._resources));
    },

    getKbBody: function(title) {
        var paras = [];
        paras.push('This article describes how to resolve a common issue with ' + title.split(' ').slice(0, 3).join(' ') + '.');
        paras.push('Before you begin, verify that you are connected to the corporate network and that your account is in good standing.');
        paras.push('Follow the steps below in order. If the issue persists after completing all steps, escalate to the ' + this._pick(this._teams) + ' team.');
        paras.push('Step 1: Restart the affected ' + this._pick(this._devices) + ' and log in again.');
        paras.push('Step 2: Clear cached credentials and re-authenticate.');
        paras.push('Step 3: If the problem continues, open a new incident and reference this article.');
        return paras.join('\n\n');
    },

    type: 'DemoForgeContent'
};
