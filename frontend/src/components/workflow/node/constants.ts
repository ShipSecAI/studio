import { Loader2, CheckCircle, XCircle, Clock, Ban, ShieldAlert } from 'lucide-react';

/**
 * Status icons mapping for different node states
 */
export const STATUS_ICONS = {
  running: Loader2,
  success: CheckCircle,
  error: XCircle,
  waiting: Clock,
  awaiting_input: ShieldAlert,
  skipped: Ban,
  idle: null,
} as const;

/**
 * Text block size constraints
 */
export const TEXT_BLOCK_SIZES = {
  MIN_WIDTH: 280,
  MAX_WIDTH: 1800,
  MIN_HEIGHT: 220,
  MAX_HEIGHT: 1200,
  DEFAULT_WIDTH: 320,
  DEFAULT_HEIGHT: 300,
} as const;

/**
 * Terminal dimensions for positioning
 */
export const TERMINAL_DIMENSIONS = {
  WIDTH: 520,
  HEIGHT: 402, // 360px content + ~40px header + 2px borders
  GAP: 35, // Gap between terminal bottom and parent top
} as const;
