# Custom OpenSearch Dashboards image for SaaS tenant lockdown
# Source: https://github.com/ShipSecAI/tools/tree/main/misc/opensearch-dashboards-saas
#
# Removes unwanted plugins from sidebar. Config-level disabling is NOT possible
# because OSD 2.x plugins don't register an "enabled" config key (fatal error).
# See the tools repo README for full documentation.

FROM opensearchproject/opensearch-dashboards:2.11.1

RUN /usr/share/opensearch-dashboards/bin/opensearch-dashboards-plugin remove queryWorkbenchDashboards && \
    /usr/share/opensearch-dashboards/bin/opensearch-dashboards-plugin remove reportsDashboards && \
    /usr/share/opensearch-dashboards/bin/opensearch-dashboards-plugin remove anomalyDetectionDashboards && \
    /usr/share/opensearch-dashboards/bin/opensearch-dashboards-plugin remove customImportMapDashboards && \
    /usr/share/opensearch-dashboards/bin/opensearch-dashboards-plugin remove securityAnalyticsDashboards && \
    /usr/share/opensearch-dashboards/bin/opensearch-dashboards-plugin remove searchRelevanceDashboards && \
    /usr/share/opensearch-dashboards/bin/opensearch-dashboards-plugin remove mlCommonsDashboards && \
    /usr/share/opensearch-dashboards/bin/opensearch-dashboards-plugin remove indexManagementDashboards && \
    /usr/share/opensearch-dashboards/bin/opensearch-dashboards-plugin remove observabilityDashboards
