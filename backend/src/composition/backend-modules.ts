import type { Type } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AsmModule } from '../asm/asm.module';
import { AssetDiscoveryModule } from '../asset-discovery/asset-discovery.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { ComponentsModule } from '../components/components.module';
import { GitHubAppModule } from '../github-app/github-app.module';
import { HotplugModule } from '../hotplug/hotplug.module';
import { HumanInputsModule } from '../human-inputs/human-inputs.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { McpModule } from '../mcp/mcp.module';
import { McpGroupsModule } from '../mcp-groups/mcp-groups.module';
import { McpServersModule } from '../mcp-servers/mcp-servers.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { SecretsModule } from '../secrets/secrets.module';
import { SlackBotModule } from '../slack-bot/slack-bot.module';
import { StorageModule } from '../storage/storage.module';
import { StudioMcpModule } from '../studio-mcp/studio-mcp.module';
import { TemplatesModule } from '../templates/templates.module';
import { TestingSupportModule } from '../testing/testing.module';
import { TraceModule } from '../trace/trace.module';
import { AgentSkillsModule } from '../agent-skills/agent-skills.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { WorkflowTemplatesModule } from '../workflow-templates/workflow-templates.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { ReportTemplatesModule } from '../report-templates/report-templates.module';
import { SecurityIngestionModule } from '../security-ingestion/security-ingestion.module';
import { SecurityWikisModule } from '../security-wikis/security-wikis.module';
import { loadBackendCloudModules } from './backend-cloud-loader';

type NestModule = Type<unknown>;

export function getCoreBackendModules(): NestModule[] {
  return [
    AgentsModule,
    AnalyticsModule,
    AuthModule,
    OnboardingModule,
    WorkflowsModule,
    TraceModule,
    ComponentsModule,
    StorageModule,
    SecretsModule,
    IntegrationsModule,
    SchedulesModule,
    ApiKeysModule,
    WebhooksModule,
    HumanInputsModule,
    McpServersModule,
    McpGroupsModule,
    McpModule,
    GitHubAppModule,
    StudioMcpModule,
    TemplatesModule,
    WorkflowTemplatesModule,
    ReportTemplatesModule,
    AsmModule,
    AssetDiscoveryModule,
    AuditModule,
    ChatModule,
    AgentSkillsModule,
    HotplugModule,
    SlackBotModule,
    SecurityIngestionModule,
    SecurityWikisModule,
  ];
}

export function getOptionalBackendModules(): NestModule[] {
  return loadBackendCloudModules();
}

export function getTestingBackendModules(): NestModule[] {
  return process.env.NODE_ENV === 'production' ? [] : [TestingSupportModule];
}
