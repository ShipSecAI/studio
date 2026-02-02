import * as fs from 'fs';
import * as path from 'path';

const DEBUG_LOG_DIR = '/tmp/shipsec-debug';
const DEBUG_LOG_FILE = path.join(DEBUG_LOG_DIR, 'worker.log');
const HEARTBEAT_LOG_FILE = path.join(DEBUG_LOG_DIR, 'heartbeat.log');

// Ensure debug directory exists
if (!fs.existsSync(DEBUG_LOG_DIR)) {
  fs.mkdirSync(DEBUG_LOG_DIR, { recursive: true });
}

interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  context: string;
  message: string;
  data?: unknown;
}

/**
 * Structured logging for debugging
 */
export class DebugLogger {
  private context: string;
  private enableConsole: boolean;

  constructor(context: string, enableConsole = false) {
    this.context = context;
    // Only log to console if explicitly enabled or DEBUG_LOGS_CONSOLE env var set
    this.enableConsole = enableConsole || process.env.DEBUG_LOGS_CONSOLE === 'true';
  }

  private writeLog(level: string, message: string, data?: unknown) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: level as 'debug' | 'info' | 'warn' | 'error',
      context: this.context,
      message,
      data,
    };

    // Write to file
    try {
      const logLine = JSON.stringify(entry);
      fs.appendFileSync(DEBUG_LOG_FILE, logLine + '\n');
    } catch (_err) {
      // Silently fail if we can't write
    }

    // Also log to console if enabled
    if (this.enableConsole) {
      console.log(`[${entry.timestamp}] [${level}] [${this.context}] ${message}`, data ? data : '');
    }
  }

  debug(message: string, data?: unknown) {
    this.writeLog('debug', message, data);
  }

  info(message: string, data?: unknown) {
    this.writeLog('info', message, data);
  }

  warn(message: string, data?: unknown) {
    this.writeLog('warn', message, data);
  }

  error(message: string, data?: unknown) {
    this.writeLog('error', message, data);
  }
}

/**
 * Log heartbeat only to dedicated file, not to console
 */
export function logHeartbeat(taskQueue: string) {
  const entry = {
    timestamp: new Date().toISOString(),
    taskQueue,
  };

  try {
    fs.appendFileSync(HEARTBEAT_LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (_err) {
    // Silently fail
  }
}

/**
 * Get recent logs from debug file
 */
export function getRecentLogs(lines = 100): LogEntry[] {
  try {
    const content = fs.readFileSync(DEBUG_LOG_FILE, 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim())
      .slice(-lines)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as LogEntry[];
  } catch {
    return [];
  }
}

/**
 * Get logs filtered by context
 */
export function getLogsByContext(context: string, lines = 100): LogEntry[] {
  return getRecentLogs(lines * 2).filter((log) => log.context.includes(context));
}

/**
 * Get logs filtered by level
 */
export function getLogsByLevel(level: string, lines = 100): LogEntry[] {
  return getRecentLogs(lines * 2).filter((log) => log.level === level);
}

/**
 * Clear debug logs
 */
export function clearDebugLogs() {
  try {
    fs.writeFileSync(DEBUG_LOG_FILE, '');
    fs.writeFileSync(HEARTBEAT_LOG_FILE, '');
  } catch {
    // Silently fail
  }
}

export function getDebugLogPath() {
  return DEBUG_LOG_FILE;
}

export function getHeartbeatLogPath() {
  return HEARTBEAT_LOG_FILE;
}
