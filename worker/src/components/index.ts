/**
 * Component Registration
 * Import all component implementations to register them in the registry
 */

import { initializeDestinationAdapters } from '../destinations';

initializeDestinationAdapters();

// Core components
import './core/entry-point';
import './core/file-loader';
import './core/http-request';
import './core/logic-script';
import './core/test-error-generator';
import './notification/slack';
import './core/text-splitter';
import './core/text-joiner';
import './core/console-log';
import './core/secret-fetch';
import './core/array-pick';
import './core/array-pack';
import './core/artifact-writer';
import './core/file-writer';
import './core/credentials-aws';
import './core/destination-artifact';
import './core/destination-s3';
import './core/text-block';
import './core/workflow-call';
import './core/mcp-server';
// Manual Action components
import './manual-action/manual-approval';
import './manual-action/manual-selection';
import './manual-action/manual-form';
import './ai/openai-provider';
import './ai/gemini-provider';
import './ai/openrouter-provider';
import './ai/ai-agent';
import './ai/llm-generate-text';
import './ai/mcp-http-provider';
import './ai/mcp-tool-merge';

// Security components
import './security/subfinder';
import './security/amass';
import './security/naabu';
import './security/dnsx';
import './security/httpx';
import './security/nuclei';
import './security/supabase-scanner';
import './security/notify';
import './security/prowler-scan';
import './security/shuffledns-massdns';
import './it-automation/atlassian-offboarding';
import './security/trufflehog';
import './security/terminal-demo';
import './security/virustotal';
import './security/abuseipdb';

// GitHub components
import './github/connection-provider';
import './github/remove-org-membership';

// IT Automation components
import './it-automation/google-workspace-license-unassign';
import './it-automation/okta-user-offboard';

// Test utility components
import './test/sleep-parallel';
import './test/live-event-heartbeat';

// Export registry for external use
export { componentRegistry } from '@shipsec/component-sdk';
