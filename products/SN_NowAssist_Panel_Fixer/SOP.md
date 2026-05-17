# SOP: SN NowAssist Panel Fixer
## Product ID: 9 | Release: ZURICH | Copyright: Vladimir Kapustin | License: AGPL-3.0

### Objective
PRB1938544: Now Assist Panel не загружается после Zurich из-за отсутствия /uxasset/externals/autosize. Сканер проверяет наличие UX assets, валидирует dependencies, генерирует fix scripts.

### Test Plan (10 tests)
#### T1: Instance Connection
#### T2: Scan sys_ux_lib for autosize.js presence
#### T3: Scan sys_ui_script for Now Assist Panel dependencies
#### T4: Detect missing externals (autosize, lodash, jQuery) in UX assets
#### T5: Validate Now Assist Panel configuration (sys_ux_macro)
#### T6: Generate fix script for missing autosize import
#### T7: Generate fix script for broken UX asset reference
#### T8: Preview mode (no destructive changes)
#### T9: HTML report with broken assets + fixes
#### T10: Full pipeline (scan → detect → generate → export)
