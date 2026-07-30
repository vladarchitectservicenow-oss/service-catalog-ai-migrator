// SN Transform Map Health Auditor — REST: GET /status
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// IIFE entry point for Scripted REST API GET /api/x_snc_tmh/status.
// Dispatches to TransformMapHealthAPI.process().

(function process(request, response) {
    var api = new x_snc_tmh.TransformMapHealthAPI();
    api.process(request, response);
})(request, response);
