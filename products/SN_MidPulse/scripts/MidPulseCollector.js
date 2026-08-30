// MidPulse — Mid Server Health & Queue Monitor — MidPulseCollector
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Data collection engine. Reads Mid Server runtime state from the OOTB
// ecc_agent, ecc_queue, and ecc_agent_parameter tables (read-only cross-scope)
// and probes each Mid Server's /status endpoint over REST for live JVM
// thread-pool and memory telemetry that is invisible from the instance UI.
//
// @class MidPulseCollector @namespace x_midpulse
var MidPulseCollector = Class.create();
MidPulseCollector.prototype = {
    initialize: function () {
        this._config = null;
    },

    /**
     * Load the active configuration record (x_midpulse_config).
     * Returns a plain object with defaults applied when no config exists.
     */
    _loadConfig: function () {
        if (this._config) {
            return this._config;
        }
        var cfg = {
            thresholds: { queue_depth: 1000, heartbeat_age_min: 15, thread_pool_pct: 90, memory_pct: 90, degraded_threshold: 60 },
            recipients: [],
            ai_config: { provider: "", model: "", prompt_tmpl: "" },
            agent_map: []
        };
        var gr = new GlideRecord("x_midpulse_config");
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            cfg.thresholds = this._safeParse(gr.getValue("thresholds_json"), cfg.thresholds);
            cfg.recipients = this._safeParse(gr.getValue("recipients_json"), cfg.recipients);
            cfg.ai_config = this._safeParse(gr.getValue("ai_config_json"), cfg.ai_config);
            cfg.agent_map = this._safeParse(gr.getValue("agent_map_json"), cfg.agent_map);
        }
        this._config = cfg;
        return cfg;
    },

    /**
     * Tolerant JSON parse. Returns fallback on any malformed input.
     */
    _safeParse: function (raw, fallback) {
        if (!raw) {
            return fallback;
        }
        try {
            var parsed = JSON.parse(raw);
            return parsed || fallback;
        } catch (e) {
            return fallback;
        }
    },

    /**
     * Generate an AI narrative via the configured GenAI provider (Now Assist /
     * Generative AI Controller BYOK). Consumes cfg.ai_config (provider, model,
     * prompt_tmpl). Falls back to null when no provider is configured or the
     * call fails, so callers can degrade to deterministic prose.
     */
    generateAINarrative: function (prompt) {
        var cfg = this._loadConfig();
        var ai = cfg.ai_config || {};
        if (!ai.provider || !ai.model) {
            return null;
        }
        try {
            var tmpl = ai.prompt_tmpl || "{prompt}";
            var fullPrompt = tmpl.replace("{prompt}", prompt);
            var req = new sn_ws.RESTMessageV2();
            req.setHttpMethod("POST");
            req.setEndpoint("/api/sn_generative_ai/now_llm/chat/completions");
            req.setRequestHeader("Accept", "application/json");
            req.setRequestHeader("Content-Type", "application/json");
            req.setRequestBody(JSON.stringify({
                provider: ai.provider,
                model: ai.model,
                messages: [{ role: "user", content: fullPrompt }],
                max_tokens: 300,
                temperature: 0.2
            }));
            var resp = req.execute();
            var code = resp.getStatusCode();
            if (code < 200 || code >= 300) {
                return null;
            }
            var data = this._safeParse(resp.getBody(), null);
            if (!data || !data.choices || data.choices.length === 0) {
                return null;
            }
            var text = data.choices[0].message && data.choices[0].message.content;
            return text || null;
        } catch (e) {
            gs.error("MidPulse generateAINarrative failed: " + e);
            return null;
        }
    },

    /**
     * Read all registered Mid Servers from ecc_agent.
     * Returns an array of agent descriptor objects.
     */
    collectAgents: function () {
        var agents = [];
        var gr = new GlideRecord("ecc_agent");
        gr.addQuery("status", "Up");
        gr.query();
        while (gr.next()) {
            agents.push({
                sys_id: gr.getUniqueValue(),
                name: gr.getValue("name") || "",
                status: gr.getValue("status") || "",
                version: gr.getValue("version") || "",
                host: gr.getValue("host_name") || "",
                ip: gr.getValue("ip_address") || "",
                last_updated: gr.getValue("sys_updated_on") || ""
            });
        }
        return agents;
    },

    /**
     * Compute queue depth, oldest item age, and stuck-item count per agent
     * using GlideAggregate (avoids getRowCount() full-scan anti-pattern).
     * Returns a map keyed by agent sys_id.
     */
    collectQueue: function () {
        var queueMap = {};
        var ga = new GlideAggregate("ecc_queue");
        ga.addQuery("state", "ready");
        ga.groupBy("agent");
        ga.addAggregate("COUNT");
        ga.query();
        while (ga.next()) {
            var agentId = ga.agent + "";
            queueMap[agentId] = {
                depth: parseInt(ga.getAggregate("COUNT"), 10) || 0,
                oldest_age_min: 0,
                stuck_count: 0
            };
        }

        // Oldest age + stuck count per agent (bounded query window).
        var gr = new GlideRecord("ecc_queue");
        gr.addQuery("state", "ready");
        gr.orderByDesc("sys_created_on");
        gr.setLimit(5000);
        gr.query();
        var now = new GlideDateTime();
        while (gr.next()) {
            var agentId = gr.agent + "";
            if (!queueMap[agentId]) {
                queueMap[agentId] = { depth: 0, oldest_age_min: 0, stuck_count: 0 };
            }
            var created = new GlideDateTime(gr.getValue("sys_created_on"));
            var ageMs = now.getNumericValue() - created.getNumericValue();
            var ageMin = Math.floor(ageMs / 60000);
            if (ageMin > queueMap[agentId].oldest_age_min) {
                queueMap[agentId].oldest_age_min = ageMin;
            }
            if (ageMin > 60) {
                queueMap[agentId].stuck_count += 1;
            }
        }
        return queueMap;
    },

    /**
     * Read IP-range and capability configuration from ecc_agent_parameter.
     * Returns a map keyed by agent sys_id.
     */
    collectParams: function () {
        var paramMap = {};
        var gr = new GlideRecord("ecc_agent_parameter");
        gr.query();
        while (gr.next()) {
            var agentId = gr.getValue("agent") + "";
            if (!paramMap[agentId]) {
                paramMap[agentId] = { ip_range: "", capabilities: [] };
            }
            var name = gr.getValue("name") || "";
            var value = gr.getValue("value") || "";
            if (name === "mid.server.ip_range" || name.indexOf("ip_range") > -1) {
                paramMap[agentId].ip_range = value;
            } else if (name === "mid.server.capabilities" || name.indexOf("capabilit") > -1) {
                paramMap[agentId].capabilities = value.split(",");
            }
        }
        return paramMap;
    },

    /**
     * Probe a single Mid Server's /status endpoint over REST.
     * Returns a runtime descriptor or null on failure (graceful degradation).
     */
    probeStatus: function (agent) {
        var host = agent.host || agent.ip;
        if (!host) {
            return null;
        }
        var cfg = this._loadConfig();
        var port = 8082;
        var statusUrl = "";
        var i;
        for (i = 0; i < cfg.agent_map.length; i++) {
            if (cfg.agent_map[i].agent_sys_id === agent.sys_id) {
                port = cfg.agent_map[i].port || port;
                statusUrl = cfg.agent_map[i].status_url || "";
                break;
            }
        }
        if (!statusUrl) {
            statusUrl = "http://" + host + ":" + port + "/status";
        }
        try {
            var rm = new sn_ws.RESTMessageV2();
            rm.setHttpMethod("GET");
            rm.setEndpoint(statusUrl);
            rm.setRequestHeader("Accept", "application/json");
            rm.setHttpTimeout(5000);
            var resp = rm.execute();
            var code = resp.getStatusCode();
            if (code < 200 || code >= 300) {
                return null;
            }
            var body = resp.getBody();
            var data = this._safeParse(body, null);
            if (!data) {
                return null;
            }
            return {
                thread_pool_pct: this._num(data.threadPoolUtilization, data.thread_pool_pct, data.threadPool),
                memory_pct: this._num(data.memoryUtilization, data.memory_pct, data.memory),
                jvm_uptime: data.jvmUptime || data.uptime || "",
                reachable: true
            };
        } catch (e) {
            return null;
        }
    },

    /**
     * Coerce a numeric value from several possible keys, defaulting to -1.
     */
    _num: function () {
        var i;
        for (i = 0; i < arguments.length; i++) {
            var v = arguments[i];
            if (v === undefined || v === null || v === "") {
                continue;
            }
            var n = parseFloat(v);
            if (!isNaN(n)) {
                return n;
            }
        }
        return -1;
    },

    /**
     * Full health sweep: collect agents, queue, params, and probe each agent.
     * Returns a sweep object consumed by MidPulseAnalyzer.
     */
    sweepAll: function () {
        var agents = this.collectAgents();
        var queueMap = this.collectQueue();
        var paramMap = this.collectParams();
        var i;
        for (i = 0; i < agents.length; i++) {
            var a = agents[i];
            var q = queueMap[a.sys_id] || { depth: 0, oldest_age_min: 0, stuck_count: 0 };
            var p = paramMap[a.sys_id] || { ip_range: "", capabilities: [] };
            a.queue = q;
            a.params = p;
            a.runtime = this.probeStatus(a);
        }
        return {
            taken_at: new GlideDateTime().getValue(),
            agents: agents
        };
    },

    type: "MidPulseCollector"
};
