/**
 * Structured Logger for COMMS Daemon
 *
 * Provides leveled, structured logging for all daemon components.
 * Outputs: [HH:MM:SS] [LEVEL] [component] message {fields}
 *
 * Configuration via environment variables:
 * - COMMS_LOG_LEVEL: debug | info | warn | error (default: info)
 * - COMMS_LOG_FILE: path to append logs to (optional, in addition to stdout)
 */

import * as fs from 'node:fs';
import type { LogLevel } from './types';

// ============================================================================
// Level Ordering
// ============================================================================

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

// ============================================================================
// Logger
// ============================================================================

export interface LogFields {
  component: string;
  sessionId?: string;
  agentId?: string;
  messageId?: string;
  [key: string]: unknown;
}

/**
 * Create a structured logger for a specific component.
 *
 * @example
 * ```typescript
 * const log = createLogger('sse-client');
 * log.info('Connected', { url: 'https://...' });
 * log.warn('Keepalive failed', { idleMs: 15000 });
 * log.error('Stream died', { error: err.message });
 * log.debug('Parsed frame', { eventId: '123' });
 * ```
 */
export function createLogger(component: string) {
  const minLevel = getMinLevel();
  const logFile = getLogFile();

  function shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
  }

  function formatLine(level: LogLevel, message: string, fields?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString().slice(11, 19);
    const label = LEVEL_LABELS[level];
    let line = `[${timestamp}] [${label}] [${component}] ${message}`;

    if (fields && Object.keys(fields).length > 0) {
      const sanitized: Record<string, unknown> = {};
      for (const key of Object.keys(fields)) {
        const val = fields[key];
        if (val !== undefined && val !== null) {
          sanitized[key] = val;
        }
      }
      if (Object.keys(sanitized).length > 0) {
        line += ` ${JSON.stringify(sanitized)}`;
      }
    }

    return line;
  }

  function emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (!shouldLog(level)) return;

    const line = formatLine(level, message, fields);

    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }

    if (logFile) {
      try {
        fs.appendFileSync(logFile, line + '\n');
      } catch {
        // Can't log logging errors -- avoid infinite loop
      }
    }
  }

  return {
    debug(message: string, fields?: Record<string, unknown>): void {
      emit('debug', message, fields);
    },
    info(message: string, fields?: Record<string, unknown>): void {
      emit('info', message, fields);
    },
    warn(message: string, fields?: Record<string, unknown>): void {
      emit('warn', message, fields);
    },
    error(message: string, fields?: Record<string, unknown>): void {
      emit('error', message, fields);
    },
  };
}

// ============================================================================
// Configuration Helpers
// ============================================================================

function getMinLevel(): LogLevel {
  const env = process.env.COMMS_LOG_LEVEL?.toLowerCase();
  if (env === 'debug' || env === 'info' || env === 'warn' || env === 'error') {
    return env;
  }
  return 'info';
}

function getLogFile(): string | null {
  return process.env.COMMS_LOG_FILE || null;
}
