import sqlite3, json, sys
conn = sqlite3.connect('honcho.db')
c = conn.cursor()

# --- CLEANUP LEGACY ---
c.execute("DELETE FROM products WHERE id BETWEEN 3 AND 8 OR name LIKE 'ADIS%' OR name LIKE 'BYOK%'")
affected = c.rowcount
c.execute("INSERT INTO products(name,full_name,release,status,notes) VALUES (?,?,?,?,?)",
          ('LEGACY_CLEANUP','Legacy Products Archived','ZURICH','ARCHIVED_LEGACY','IDs 3-8 + ADIS/BYOK duplicates purged in v5.0 reset'))
conn.commit()

new_products = [
    ('SN Guardian','ServiceNow Guarded Script Migration Tool','ZURICH',
     'Breaking: Guarded Script (KittyScript) enforcement blocks complex JS in filters, defaults, AMB. Admins must refactor thousands of scripts into Script Includes or exemptions before Phase 3 auto-enforcement (~4 weeks).',
     'https://reddit.com/r/servicenow/comments/1t0xwef/'),
    ('SN NowAssist Optimizer','ServiceNow Now Assist Performance Optimizer','AUSTRALIA',
     'Now Assist was purchased for Tier-1 deflection but acts as a slightly smarter Virtual Agent. KB answers are generic/wrong; employees abandon after two weeks. Need tool to audit deflection rate, KB coverage gaps, and skill routing.',
     'https://reddit.com/r/servicenow/comments/1sn8vpc/'),
    ('SN AI Agent Validator','ServiceNow AI Agent Readiness Validator','AUSTRALIA',
     'Organizations testing AI Agents report many are shipped broken and not useful in real workflows. Need validator to check agent configuration, skill bindings, role masking, A2A protocol compliance, and data readiness before production.',
     'https://reddit.com/r/servicenow/comments/1oe5meh/'),
    ('SN Platform Analytics Migrator','ServiceNow Platform Analytics Migration Assistant','AUSTRALIA',
     'Migration from Performance Analytics to Platform Analytics broke drilldown views, Ctrl+click, column sorting. Scheduled Reports lost Insert/Stay/Duplicate. Executive Dashboards must be rebuilt. Migration Center exists but is manual and error-prone.',
     'https://reddit.com/r/servicenow/comments/1s47e9m/'),
    ('SN A2A Bridge','ServiceNow A2A Protocol Integration Bridge','AUSTRALIA',
     'Australia introduces A2A Protocol for external agents but deprecated manual external agent integration (Patch 1). Organizations need automated migration from manual/external integrations to A2A-compliant agents with protocol validation.',
     'https://docs.servicenow.com/bundle/australia-release-notes/'),
]

for name, full_name, release, pain, url in new_products:
    c.execute("INSERT INTO products(name,full_name,release,pain_summary,source_url,status) VALUES (?,?,?,?,?,'QUEUED')",
              (name, full_name, release, pain, url))
conn.commit()

c.execute("SELECT id, name, full_name, release, status FROM products WHERE status='QUEUED' ORDER BY id")
rows = c.fetchall()
print(json.dumps([{'id':r[0],'name':r[1],'full_name':r[2],'release':r[3],'status':r[4]} for r in rows], ensure_ascii=False, indent=2))
conn.close()
print(f'Purged {affected} legacy rows')
