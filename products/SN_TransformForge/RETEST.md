# ServiceNow Re-test — TransformForge (`x_sntf`)

**RUN_ID:** 20260921_050121_8588
**Date:** 2026-09-21
**Role:** QA Quick Validation Agent
**Stage:** 05 — Re-test (post-fix validation)
**Author:** Vladimir Kapustin

---

## Status: **PASS**

## Checks

| Check | Result |
|---|---|
| JS syntax (`node --check`) × 4 files (engine, generator, post_execute, get_status) | ✅ all OK |
| XML well-formedness × 5 files (minidom) | ✅ all OK |
| ES5/Rhino compatibility (no `=>` in code, no `let/const`, no template literals) | ✅ clean |
| CDATA byte-match (`sys_app.xml` ↔ standalone `scripts/*.js`) | ✅ engine + generator both byte-present |
| C1 fix — `getValue('element')` in engine (uniqueness/indexing) | ✅ present (lines 158, 199) |
| H1 fix — REST ACL `Execute` + `Status` (replaces `x_sntf_api`) | ✅ present |
| H2 fix — `_compactPreview` helper in generator | ✅ present |
| H3 fix — `number_ref=TF` + `number` dict element + `TF-` GUID set | ✅ present |
| M1 fix — `_choiceEntryFor` writing `choice_map_json`/`orphans_json` | ✅ present |
| M3 fix — `parseInt` coercion in `listJobs` | ✅ present |
| M4 fix — `setWorkflow(false)` + `setLimit(1000)` in business rules | ✅ present |
| L3 fix — field-name sanitization `replace(/[^a-z0-9_]/g, '_')` | ✅ present (×3) |
| Copyright headers (Vladimir Kapustin / AGPL-3.0) | ✅ intact |

## Critical Errors

None.

## Notes

The `=>` occurrence in `TransformForgeEngine.js` line 344 is a string literal (`srcVal + '=>' + matched`), not an arrow function — not an ES5 violation.

All 12 errors declared in `05_fix.md` are resolved and verified in the build artifacts.
