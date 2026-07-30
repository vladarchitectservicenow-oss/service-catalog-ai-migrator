// SN Transform Map Health Auditor — REST: POST /execute
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// IIFE entry point for Scripted REST API POST /api/x_snc_tmh/execute.
// Dispatches to TransformMapHealthAPI.process().

(function process(request, response) {
    var api = new x_snc_tmh.TransformMapHealthAPI();
    api.process(request, response);
})(request, response);
