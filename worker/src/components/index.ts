/**
 * Component Registration
 * Import all component implementations to register them in the registry
 */

// Core components
import './core/trigger-manual';
import './core/file-loader';
import './core/webhook';
import './core/text-splitter';
import './core/console-log';

// Security components
import './security/subfinder';
import './security/amass';
import './security/naabu';
import './security/dnsx';

// Export registry for external use
export { componentRegistry } from '@shipsec/component-sdk';
