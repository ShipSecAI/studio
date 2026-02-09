import type { NodeStatus, FrontendNodeData } from '@/schemas/node';
import type { NodeVisualState } from '@/store/executionTimelineStore';
import type { InputPort, OutputPort } from '@/schemas/component';

export type { NodeStatus, FrontendNodeData, NodeVisualState, InputPort, OutputPort };

/**
 * Props for the TerminalButton component
 */
export interface TerminalButtonProps {
  id: string;
  isTerminalOpen: boolean;
  setIsTerminalOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  isTerminalLoading: boolean;
  terminalSession: { chunks?: unknown[] } | undefined;
  selectedRunId: string;
  mode: string;
  playbackMode: string;
  isLiveFollowing: boolean;
  focusedTerminalNodeId: string | null;
  bringTerminalToFront: (nodeId: string) => void;
}

/**
 * Props for the ParametersDisplay component
 */
export interface ParametersDisplayProps {
  componentParameters: any[];
  requiredParams: any[];
  nodeParameters: Record<string, any> | undefined;
  position?: 'top' | 'bottom';
}

/**
 * Props for the NodeProgressBar component
 */
export interface NodeProgressBarProps {
  progress: number;
  events: number;
  totalEvents: number;
  isRunning: boolean;
  status: NodeStatus;
}

/**
 * Node style state returned by getNodeStyle
 */
export interface NodeStyleState {
  border: string;
  bg: string;
  icon: string | null;
  iconClass?: string;
}
