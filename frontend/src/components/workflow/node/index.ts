// Re-export main component for backward compatibility
export { WorkflowNode } from './WorkflowNode';

// Export sub-components for potential reuse
export { TerminalButton } from './TerminalButton';
export { ParametersDisplay } from './ParametersDisplay';
export { NodeProgressBar } from './NodeProgressBar';

// Export types
export type {
  TerminalButtonProps,
  ParametersDisplayProps,
  NodeProgressBarProps,
  NodeStyleState,
} from './types';

// Export constants
export { STATUS_ICONS, TEXT_BLOCK_SIZES, TERMINAL_DIMENSIONS } from './constants';
