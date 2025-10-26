/**
 * Component Registration
 * Import all component implementations to register them in the registry
 */

// Core components
import './core/trigger-manual';
import './core/file-loader';
import './core/webhook';
import './core/text-splitter';
import './core/text-joiner';
import './core/console-log';
import './core/secret-fetch';
import './ai/openai-chat';
import './ai/gemini-chat';
import './ai/ai-agent';

// Security components
import './security/subfinder';
import './security/amass';
import './security/naabu';
import './security/dnsx';
import './security/httpx';
import './security/notify';

// IT Automation components
import './it-automation/google-workspace-license-unassign';

// Test utility components
import './test/sleep-parallel';

// Export registry for external use
export { componentRegistry } from '@shipsec/component-sdk';
