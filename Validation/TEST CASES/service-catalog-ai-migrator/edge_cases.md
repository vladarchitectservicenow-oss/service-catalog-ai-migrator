# Edge Cases: service-catalog-ai-migrator

**Author:** Vladimir Kapustin
**License:** AGPL-3.0-only

## Edge Case Catalog

Comprehensive list of edge conditions and how the system handles them.

### Data Boundary Edge Cases

| ID | Edge Case | Input | Expected Behavior | Status |
|----|-----------|-------|-------------------|--------|
| E01 | Empty instance | 0 records in all tables | Valid empty report, no crash | ✅ |
| E02 | Maximum records | 50,000+ records in single table | Chunked pagination, no OOM | ⚠️ |
| E03 | Single record | 1 record across entire instance | Valid minimal report | ✅ |
| E04 | Null/missing fields | Records with NULL in required fields | Graceful handling, logged warning | ⚠️ |
| E05 | Very long strings | Field values > 65KB | Truncated in report with note | ⚠️ |

### Authentication Edge Cases

| ID | Edge Case | Input | Expected Behavior | Status |
|----|-----------|-------|-------------------|--------|
| E06 | Expired token | 401 from ServiceNow | Clear error message, exit code 1 | ✅ |
| E07 | Missing credentials | No SN_USER set | Early validation error | ✅ |
| E08 | Invalid URL | Malformed instance URL | URL validation error | ✅ |
| E09 | Redirect response | 301/302 from SN | Follow redirect or error clearly | ⚠️ |

### Concurrency Edge Cases

| ID | Edge Case | Input | Expected Behavior | Status |
|----|-----------|-------|-------------------|--------|
| E10 | Simultaneous scans | Two CLI instances running | File lock prevents double run | ⚠️ |
| E11 | Write conflict on output | Output file open by another process | Atomic write or clear error | ⚠️ |

### Encoding & Locale Edge Cases

| ID | Edge Case | Input | Expected Behavior | Status |
|----|-----------|-------|-------------------|--------|
| E12 | Unicode field names | Japanese/Chinese characters in table fields | Proper UTF-8 handling | ✅ |
| E13 | Right-to-left text | Arabic/Hebrew text in records | Preserved in reports | ⚠️ |
| E14 | Emoji in data | Emoji in record values | Rendered or safely replaced | ⚠️ |

### Network Edge Cases

| ID | Edge Case | Input | Expected Behavior | Status |
|----|-----------|-------|-------------------|--------|
| E15 | Connection timeout | Network down | Retry 3x with backoff, then fail | ✅ |
| E16 | Slow response | >30s response time | Timeout with clear message | ⚠️ |
| E17 | Partial response | Truncated JSON | Parse error with details | ⚠️ |
| E18 | DNS failure | Unresolvable hostname | Clear DNS error message | ⚠️ |

### Template Edge Cases

| ID | Edge Case | Input | Expected Behavior | Status |
|----|-----------|-------|-------------------|--------|
| E19 | Missing template variable | Variable not in context | Jinja2 UndefinedError with clear message | ✅ |
| E20 | Circular include | Template includes itself | Detection and clear error | ⚠️ |
| E21 | Extremely nested data | 100+ levels deep | Truncation or recursion guard | ⚠️ |

### Legend
- ✅ Implemented and verified
- ⚠️ Not yet implemented or needs verification
- ❌ Known failure

## Verification Protocol

Run edge case tests monthly or after any major refactor:

```bash
pytest tests/ -v -k "edge" --timeout=120
```

Expected: all ✅ cases pass; ⚠️ cases produce controlled errors (no crashes).
