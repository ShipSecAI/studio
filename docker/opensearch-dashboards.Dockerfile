FROM opensearchproject/opensearch-dashboards:2.11.1

# SaaS Tenant Lockdown - Remove plugins that tenants should not access
# Allowed: Discover, Dashboards, Visualize, Alerting, Dev Tools, Home
# Keeping: alertingDashboards, notificationsDashboards (alerting dependency),
#          securityDashboards (proxy auth/multitenancy), ganttChartDashboards (viz type)

RUN /usr/share/opensearch-dashboards/bin/opensearch-dashboards-plugin remove queryWorkbenchDashboards && \
    /usr/share/opensearch-dashboards/bin/opensearch-dashboards-plugin remove reportsDashboards && \
    /usr/share/opensearch-dashboards/bin/opensearch-dashboards-plugin remove anomalyDetectionDashboards && \
    /usr/share/opensearch-dashboards/bin/opensearch-dashboards-plugin remove customImportMapDashboards && \
    /usr/share/opensearch-dashboards/bin/opensearch-dashboards-plugin remove securityAnalyticsDashboards && \
    /usr/share/opensearch-dashboards/bin/opensearch-dashboards-plugin remove searchRelevanceDashboards && \
    /usr/share/opensearch-dashboards/bin/opensearch-dashboards-plugin remove mlCommonsDashboards && \
    /usr/share/opensearch-dashboards/bin/opensearch-dashboards-plugin remove indexManagementDashboards && \
    /usr/share/opensearch-dashboards/bin/opensearch-dashboards-plugin remove observabilityDashboards
