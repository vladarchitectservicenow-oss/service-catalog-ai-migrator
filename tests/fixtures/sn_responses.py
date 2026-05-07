"""Mock ServiceNow data factory for integration tests.

Generates realistic Pydantic model instances that exercise all
analyzer and generator paths in the pipeline.
"""

from src.models import (
    CatalogItem,
    Workflow,
    WorkflowActivity,
    ScriptInclude,
    BusinessRule,
    RESTIntegration,
    RequestHistory,
)


class MockServiceNowData:
    """Factory class for generating mock ServiceNow discovery data."""

    # ------------------------------------------------------------------
    # Catalog Items
    # ------------------------------------------------------------------

    @staticmethod
    def catalog_items(n: int = 3) -> list[CatalogItem]:
        """Generate n mock catalog items with realistic diversity."""
        all_items = [
            CatalogItem(
                sys_id="item_001",
                name="Employee Onboarding",
                short_description="New employee onboarding request including accounts, email, hardware, and access",
                description="Comprehensive onboarding workflow used by HR to provision all resources for new hires.",
                category="HR",
                active=True,
                workflow_id="wf_001",
                variables=[
                    {"name": "start_date", "type": "date"},
                    {"name": "department", "type": "choice"},
                    {"name": "manager_sys_id", "type": "sys_user_reference"},
                ],
                request_count=150,
                approval_required=True,
            ),
            CatalogItem(
                sys_id="item_002",
                name="Laptop Request",
                short_description="Standard laptop provisioning for employees",
                description="Request a standard-issue laptop with pre-installed software. Includes inventory check.",
                category="IT",
                active=True,
                workflow_id="wf_002",
                variables=[
                    {"name": "laptop_model", "type": "choice"},
                    {"name": "cost_center", "type": "string"},
                ],
                request_count=500,
                approval_required=True,
            ),
            CatalogItem(
                sys_id="item_003",
                name="Access Card Request",
                short_description="Building access card for employees and contractors",
                description="Request a new or replacement building access card. Automatically prints and dispatches.",
                category="Facilities",
                active=True,
                workflow_id="wf_003",
                variables=[
                    {"name": "access_level", "type": "choice"},
                    {"name": "building", "type": "choice"},
                ],
                request_count=300,
                approval_required=False,
            ),
        ]
        return all_items[:n]

    # ------------------------------------------------------------------
    # Workflows
    # ------------------------------------------------------------------

    @staticmethod
    def workflows() -> list[Workflow]:
        """Generate realistic workflows with diverse complexity.

        wf_001 — Complex onboarding (low readiness: many approvals, manual steps)
        wf_002 — Medium laptop provisioning (medium readiness)
        wf_003 — Simple access card (high readiness)
        """
        return [
            # ---- wf_001: Onboarding (complex, low readiness) ----
            Workflow(
                sys_id="wf_001",
                name="Onboarding Workflow",
                table="sc_req_item",
                active=True,
                version="v2.3",
                catalog_item_sys_ids=["item_001"],
                activities=[
                    WorkflowActivity(
                        sys_id="act_001",
                        name="Initial Validation",
                        activity_type="task",
                        description="Validate that all required fields are populated",
                        is_manual=True,
                    ),
                    WorkflowActivity(
                        sys_id="act_002",
                        name="Manager Approval",
                        activity_type="approval",
                        description="Manager confirms new hire details",
                        condition="true",
                        is_manual=False,
                    ),
                    WorkflowActivity(
                        sys_id="act_003",
                        name="HR Review",
                        activity_type="approval",
                        description="HR reviews and confirms onboarding package",
                        is_manual=False,
                    ),
                    WorkflowActivity(
                        sys_id="act_004",
                        name="Create AD Account",
                        activity_type="script",
                        description="Script to provision Active Directory account via LDAP",
                        is_manual=False,
                    ),
                    WorkflowActivity(
                        sys_id="act_005",
                        name="Assign Email",
                        activity_type="task",
                        description="Assign email address and mailbox",
                        is_manual=True,
                    ),
                    WorkflowActivity(
                        sys_id="act_006",
                        name="Setup Laptop",
                        activity_type="task",
                        description="IT provisions laptop and installs software",
                        is_manual=True,
                    ),
                    WorkflowActivity(
                        sys_id="act_007",
                        name="IT Director Approval",
                        activity_type="approval",
                        description="IT Director approves high-cost hardware requests",
                        condition="current.variables.cost_estimate > 2000",
                        is_manual=False,
                    ),
                    WorkflowActivity(
                        sys_id="act_008",
                        name="Grant Building Access",
                        activity_type="task",
                        description="Assign building access card and parking permit",
                        is_manual=True,
                    ),
                    WorkflowActivity(
                        sys_id="act_009",
                        name="Send Welcome Email",
                        activity_type="script",
                        description="Script to send welcome email to new hire and their manager",
                        is_manual=False,
                    ),
                    WorkflowActivity(
                        sys_id="act_010",
                        name="Wait for Systems Sync",
                        activity_type="timer",
                        description="Wait 24 hours for all systems to sync",
                        is_manual=False,
                        duration_minutes=1440,
                    ),
                    WorkflowActivity(
                        sys_id="act_011",
                        name="Verify Setup",
                        activity_type="task",
                        description="Manual verification that all accounts work correctly",
                        is_manual=True,
                    ),
                    WorkflowActivity(
                        sys_id="act_012",
                        name="Close Request",
                        activity_type="script",
                        description="Script to close the request and log to audit trail",
                        is_manual=False,
                    ),
                ],
            ),
            # ---- wf_002: Laptop (medium readiness) ----
            Workflow(
                sys_id="wf_002",
                name="Laptop Provisioning",
                table="sc_req_item",
                active=True,
                version="v1.5",
                catalog_item_sys_ids=["item_002"],
                activities=[
                    WorkflowActivity(
                        sys_id="act_101",
                        name="Validate Request",
                        activity_type="task",
                        description="Check that request has valid cost center and model",
                        is_manual=False,
                    ),
                    WorkflowActivity(
                        sys_id="act_102",
                        name="Manager Approval",
                        activity_type="approval",
                        description="Manager approves laptop request",
                        condition="true",
                        is_manual=False,
                    ),
                    WorkflowActivity(
                        sys_id="act_103",
                        name="Check Inventory",
                        activity_type="script",
                        description="Query inventory system for available laptops",
                        is_manual=False,
                    ),
                    WorkflowActivity(
                        sys_id="act_104",
                        name="IT Approval",
                        activity_type="approval",
                        description="IT verifies inventory and approves provisioning",
                        is_manual=False,
                    ),
                    WorkflowActivity(
                        sys_id="act_105",
                        name="Provision Laptop",
                        activity_type="task",
                        description="Physically prepare laptop with OS and standard software",
                        is_manual=True,
                    ),
                    WorkflowActivity(
                        sys_id="act_106",
                        name="Install Software",
                        activity_type="task",
                        description="Install department-specific software on laptop",
                        is_manual=True,
                    ),
                    WorkflowActivity(
                        sys_id="act_107",
                        name="Send Notification",
                        activity_type="script",
                        description="Notify user that laptop is ready for pickup",
                        is_manual=False,
                    ),
                ],
            ),
            # ---- wf_003: Access Card (high readiness) ----
            Workflow(
                sys_id="wf_003",
                name="Access Card Issuance",
                table="sc_req_item",
                active=True,
                version="v1.0",
                catalog_item_sys_ids=["item_003"],
                activities=[
                    WorkflowActivity(
                        sys_id="act_201",
                        name="Validate Request",
                        activity_type="task",
                        description="Verify access level and building are valid",
                        is_manual=False,
                    ),
                    WorkflowActivity(
                        sys_id="act_202",
                        name="Print Card",
                        activity_type="script",
                        description="Send print job to card printer",
                        is_manual=False,
                    ),
                    WorkflowActivity(
                        sys_id="act_203",
                        name="Notify Security",
                        activity_type="script",
                        description="Notify security team that card has been printed",
                        is_manual=False,
                    ),
                ],
            ),
        ]

    # ------------------------------------------------------------------
    # Script Includes
    # ------------------------------------------------------------------

    @staticmethod
    def script_includes() -> list[ScriptInclude]:
        """Generate script includes with a mix of clean and problematic code."""
        return [
            ScriptInclude(
                sys_id="si_001",
                name="UserProvisioningUtil",
                api_name="x_org.UserProvisioningUtil",
                description="Utility class for provisioning users in Active Directory",
                script="""var UserProvisioningUtil = Class.create();
UserProvisioningUtil.prototype = {
    initialize: function() {},
    
    createUser: function(userData) {
        var gr = new GlideRecord('sys_user');
        gr.initialize();
        gr.setValue('user_name', userData.username);
        gr.setValue('first_name', userData.firstName);
        gr.setValue('last_name', userData.lastName);
        var sysId = gr.insert();
        gs.log('Created user: ' + sysId);
        return sysId;
    },
    
    lookupManager: function(managerId) {
        var gr = new GlideRecord('sys_user');
        if (gr.get(managerId)) {
            return gr.getValue('name');
        }
        gs.info('Manager not found: ' + managerId);
        return null;
    },
    
    type: 'UserProvisioningUtil'
};""",
                active=True,
                access="package_private",
            ),
            ScriptInclude(
                sys_id="si_002",
                name="EmailHelper",
                api_name="x_org.EmailHelper",
                description="Helper for sending templated emails",
                script="""var EmailHelper = Class.create();
EmailHelper.prototype = {
    initialize: function() {},

    sendOnboardingEmail: function(userEmail, managerEmail) {
        var templateSysId = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
        var mail = new GlideEmailOutbound();
        mail.setTo(userEmail);
        mail.setSubject('Welcome to the company!');
        mail.setBody('Your onboarding is complete.');
        mail.send();
        gs.log('Sent welcome email to ' + userEmail);
    },

    sendToAdmin: function(subject, body) {
        var mail = new GlideEmailOutbound();
        mail.setTo('admin@company.com');
        mail.setSubject(subject);
        mail.setBody(body);
        mail.send();
    },

    type: 'EmailHelper'
};""",
                active=True,
                access="package_private",
            ),
            ScriptInclude(
                sys_id="si_003",
                name="DataTransformer",
                api_name="x_org.DataTransformer",
                description="Transform and enrich request data for downstream systems",
                script="""var DataTransformer = Class.create();
DataTransformer.prototype = {
    initialize: function() {},

    transformToApiPayload: function(requestData) {
        var payload = {
            user_id: requestData.userId,
            department: requestData.department || 'General',
            start_date: requestData.startDate,
            manager_email: this.lookupManagerEmail(requestData.managerId)
        };
        return JSON.stringify(payload);
    },

    lookupManagerEmail: function(managerId) {
        var email = '';
        var ga = new GlideAggregate('sys_user');
        ga.addQuery('sys_id', managerId);
        ga.addAggregate('email');
        ga.query();
        if (ga.next()) {
            email = ga.getAggregate('email');
        }
        return email;
    },

    type: 'DataTransformer'
};""",
                active=True,
                access="package_private",
            ),
            ScriptInclude(
                sys_id="si_004",
                name="APIClient",
                api_name="x_org.APIClient",
                description="Generic REST API client for external integrations",
                script="""var APIClient = Class.create();
APIClient.prototype = {
    initialize: function(endpoint) {
        this.endpoint = endpoint;
    },

    callExternalApi: function(payload) {
        var request = new RESTMessageV2();
        request.setEndpoint(this.endpoint);
        request.setHttpMethod('POST');
        request.setRequestBody(JSON.stringify(payload));
        request.setRequestHeader('Content-Type', 'application/json');
        var response = request.execute();
        var statusCode = response.getStatusCode();
        if (statusCode != 200) {
            // No error handling
        }
        return JSON.parse(response.getBody());
    },

    syncToExternal: function(data) {
        var http = new GlideHTTPRequest('https://api.external-system.com/v1/sync');
        http.setHttpMethod('POST');
        http.setRequestHeader('Authorization', 'Bearer 12345');
        var resp = http.execute();
        return resp.getBody();
    },

    type: 'APIClient'
};""",
                active=True,
                access="package_private",
            ),
        ]

    # ------------------------------------------------------------------
    # Business Rules
    # ------------------------------------------------------------------

    @staticmethod
    def business_rules() -> list[BusinessRule]:
        """Generate business rules with diverse when/action combinations."""
        return [
            BusinessRule(
                sys_id="br_001",
                name="Validate Onboarding Fields",
                table="sc_req_item",
                when="before",
                order=100,
                active=True,
                condition="current.cat_item.sys_id == 'item_001'",
                script="""(function executeRule(current, previous /*null when async*/) {
    var gr = new GlideRecord('sys_user');
    gr.addQuery('user_name', current.variables.employee_id);
    gr.query();
    if (gr.next()) {
        current.setAbortAction(true);
    }
})(current, previous);""",
                action_insert=True,
                action_update=False,
                action_delete=False,
                action_query=False,
            ),
            BusinessRule(
                sys_id="br_002",
                name="Auto-close Fulfilled Requests",
                table="sc_req_item",
                when="after",
                order=200,
                active=True,
                condition="current.state == 3",
                script="""(function executeRule(current, previous /*null when async*/) {
    var now = new GlideDateTime();
    current.setWorkflow(false);
    current.closed_at = now;
    current.update();
})(current, previous);""",
                action_insert=False,
                action_update=True,
                action_delete=False,
                action_query=False,
            ),
            BusinessRule(
                sys_id="br_003",
                name="Sync to External HR System",
                table="sc_req_item",
                when="async",
                order=50,
                active=True,
                condition="current.cat_item.sys_id == 'item_001' && current.state == 3",
                script="""(function executeRule(current, previous /*null when async*/) {
    var rm = new RESTMessageV2('HR System', 'sync_new_hire');
    rm.setStringParameter('employee_id', current.variables.employee_id);
    rm.setStringParameter('start_date', current.variables.start_date);
    var response = rm.execute();
    if (response.getStatusCode() != 200) {
        gs.error('HR sync failed: ' + response.getErrorMessage());
    }
})(current, previous);""",
                action_insert=False,
                action_update=True,
                action_delete=False,
                action_query=False,
            ),
            BusinessRule(
                sys_id="br_004",
                name="Format Access Card Display",
                table="sc_req_item",
                when="display",
                order=10,
                active=True,
                condition="current.cat_item.sys_id == 'item_003'",
                script="""(function executeRule(current, previous /*null when async*/) {
    current.building_name = current.variables.building.getDisplayValue();
    current.access_level_label = current.variables.access_level.getDisplayValue();
})(current, previous);""",
                action_insert=False,
                action_update=False,
                action_delete=False,
                action_query=True,
            ),
        ]

    # ------------------------------------------------------------------
    # REST Integrations
    # ------------------------------------------------------------------

    @staticmethod
    def integrations() -> list[RESTIntegration]:
        """Generate REST integrations representing external dependencies."""
        return [
            RESTIntegration(
                sys_id="integ_001",
                name="LDAP Directory Sync",
                endpoint="ldaps://ldap.internal.company.com:636/dc=company,dc=com",
                http_method="POST",
                description="Synchronizes user accounts with corporate Active Directory / LDAP",
                active=True,
                retry_policy="exponential_backoff",
            ),
            RESTIntegration(
                sys_id="integ_002",
                name="SMTP Notification Gateway",
                endpoint="https://smtp.company.com/api/v1/send",
                http_method="POST",
                description="Sends email notifications via corporate SMTP gateway",
                active=True,
                retry_policy="simple_retry",
            ),
            RESTIntegration(
                sys_id="integ_003",
                name="Custom HR API",
                endpoint="https://api.hr-system.com/v1/employees",
                http_method="POST",
                description="Custom integration with external HR system for employee record sync",
                active=True,
                retry_policy="exponential_backoff",
            ),
        ]

    # ------------------------------------------------------------------
    # Request History
    # ------------------------------------------------------------------

    @staticmethod
    def history() -> list[RequestHistory]:
        """Generate request history with diverse SLA profiles.

        item_001 (Onboarding): Many SLA breaches → high bottleneck impact
        item_002 (Laptop): Few breaches → moderate impact
        item_003 (Access Card): Zero breaches → clean history
        """
        return [
            RequestHistory(
                catalog_item_sys_id="item_001",
                catalog_item_name="Employee Onboarding",
                total_requests=150,
                sla_breaches=45,  # 30% breach rate → critical
                avg_fulfillment_hours=48.0,
                median_fulfillment_hours=36.0,
                approval_count=5,
                manual_task_count=8,
            ),
            RequestHistory(
                catalog_item_sys_id="item_002",
                catalog_item_name="Laptop Request",
                total_requests=500,
                sla_breaches=15,  # 3% breach rate → low
                avg_fulfillment_hours=12.0,
                median_fulfillment_hours=8.0,
                approval_count=3,
                manual_task_count=2,
            ),
            RequestHistory(
                catalog_item_sys_id="item_003",
                catalog_item_name="Access Card Request",
                total_requests=300,
                sla_breaches=0,
                avg_fulfillment_hours=4.0,
                median_fulfillment_hours=3.0,
                approval_count=0,
                manual_task_count=0,
            ),
        ]
