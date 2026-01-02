/**
 * Debug Output Formatting Utilities
 *
 * Provides consistent, human-readable output formatting for Weave debug commands.
 * Uses box drawing characters, tables, and color coding for confidence levels.
 *
 * @module weave/debug-format
 */

import type { Dimension, ConfidenceLevel, Provenance } from './types';
import { DIMENSION_NAMES, DIMENSION_LAYERS, confidenceToLevel } from './types';

// ============================================================================
// ANSI Color Codes (for terminal output)
// ============================================================================

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Background colors
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

// ============================================================================
// Box Drawing Characters
// ============================================================================

const BOX = {
  topLeft: '╔',
  topRight: '╗',
  bottomLeft: '╚',
  bottomRight: '╝',
  horizontal: '═',
  vertical: '║',
  teeRight: '╠',
  teeLeft: '╣',
  teeDown: '╦',
  teeUp: '╩',
  cross: '╬',

  // Light box for nested items
  lightTopLeft: '┌',
  lightTopRight: '┐',
  lightBottomLeft: '└',
  lightBottomRight: '┘',
  lightHorizontal: '─',
  lightVertical: '│',
  lightTeeRight: '├',
  lightTeeLeft: '┤',
};

// ============================================================================
// Confidence Color Mapping
// ============================================================================

/**
 * Get color code for confidence level.
 */
export function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.85) return COLORS.green;
  if (confidence >= 0.7) return COLORS.cyan;
  if (confidence >= 0.5) return COLORS.yellow;
  if (confidence >= 0.3) return COLORS.magenta;
  return COLORS.red;
}

/**
 * Get confidence badge with color.
 */
export function confidenceBadge(confidence: number): string {
  const color = getConfidenceColor(confidence);
  const level = confidenceToLevel(confidence);
  const percent = Math.round(confidence * 100);
  return `${color}[${percent}% ${level}]${COLORS.reset}`;
}

/**
 * Get health status color and icon.
 */
export function healthStatus(status: 'nascent' | 'developing' | 'good' | 'excellent'): string {
  switch (status) {
    case 'excellent':
      return `${COLORS.green}● Excellent${COLORS.reset}`;
    case 'good':
      return `${COLORS.cyan}● Good${COLORS.reset}`;
    case 'developing':
      return `${COLORS.yellow}● Developing${COLORS.reset}`;
    case 'nascent':
      return `${COLORS.red}● Nascent${COLORS.reset}`;
    default:
      return `${COLORS.gray}○ Unknown${COLORS.reset}`;
  }
}

// ============================================================================
// Box Drawing Functions
// ============================================================================

/**
 * Create a header box.
 */
export function headerBox(title: string, width: number = 60): string {
  const padding = Math.max(0, width - title.length - 4);
  const leftPad = Math.floor(padding / 2);
  const rightPad = padding - leftPad;

  return [
    `${BOX.topLeft}${BOX.horizontal.repeat(width - 2)}${BOX.topRight}`,
    `${BOX.vertical}${' '.repeat(leftPad)} ${COLORS.bold}${title}${COLORS.reset} ${' '.repeat(rightPad)}${BOX.vertical}`,
    `${BOX.bottomLeft}${BOX.horizontal.repeat(width - 2)}${BOX.bottomRight}`,
  ].join('\n');
}

/**
 * Create a section header.
 */
export function sectionHeader(title: string, count?: number): string {
  const countStr = count !== undefined ? ` (${count})` : '';
  return `\n${COLORS.bold}${COLORS.cyan}${title}${countStr}${COLORS.reset}\n${'─'.repeat(40)}`;
}

/**
 * Create a subsection header.
 */
export function subHeader(title: string): string {
  return `\n${COLORS.dim}${title}${COLORS.reset}`;
}

// ============================================================================
// Table Formatting
// ============================================================================

export interface TableColumn {
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

export interface TableRow {
  [key: string]: string | number;
}

/**
 * Format a table with headers and rows.
 */
export function formatTable(columns: TableColumn[], rows: TableRow[]): string {
  const lines: string[] = [];

  // Header row
  const headerLine = columns.map(col => {
    const text = col.header.slice(0, col.width);
    return padString(text, col.width, col.align || 'left');
  }).join(' │ ');
  lines.push(`${COLORS.bold}${headerLine}${COLORS.reset}`);

  // Separator
  const separator = columns.map(col => '─'.repeat(col.width)).join('─┼─');
  lines.push(separator);

  // Data rows
  for (const row of rows) {
    const rowLine = columns.map(col => {
      const value = String(row[col.header] ?? '');
      return padString(value.slice(0, col.width), col.width, col.align || 'left');
    }).join(' │ ');
    lines.push(rowLine);
  }

  return lines.join('\n');
}

/**
 * Pad a string to a specific width.
 */
function padString(str: string, width: number, align: 'left' | 'right' | 'center'): string {
  const padding = Math.max(0, width - stripAnsi(str).length);
  switch (align) {
    case 'right':
      return ' '.repeat(padding) + str;
    case 'center':
      const left = Math.floor(padding / 2);
      return ' '.repeat(left) + str + ' '.repeat(padding - left);
    default:
      return str + ' '.repeat(padding);
  }
}

/**
 * Strip ANSI codes from string for length calculation.
 */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// ============================================================================
// Knowledge Entry Formatting
// ============================================================================

export interface KnowledgeEntryDisplay {
  id: string;
  dimension: Dimension;
  summary: string;
  confidence: number;
  provenance?: Provenance;
  keywords?: string[];
  // Rich data for pain points
  resolution?: string;
  evidence?: string[];
  impact?: string;
}

/**
 * Format a single knowledge entry for display.
 */
export function formatKnowledgeEntry(entry: KnowledgeEntryDisplay, indent: number = 0): string {
  const prefix = ' '.repeat(indent);
  const lines: string[] = [];

  // ID and confidence badge
  lines.push(`${prefix}${BOX.lightTeeRight}${BOX.lightHorizontal} ${COLORS.bold}${entry.id}${COLORS.reset} ${confidenceBadge(entry.confidence)}`);

  // Summary
  lines.push(`${prefix}${BOX.lightVertical}  ${COLORS.dim}"${entry.summary}"${COLORS.reset}`);

  // Impact if available (for pain points)
  if (entry.impact) {
    lines.push(`${prefix}${BOX.lightVertical}  ${COLORS.yellow}IMPACT:${COLORS.reset} ${entry.impact}`);
  }

  // Resolution if available (for pain points)
  if (entry.resolution) {
    lines.push(`${prefix}${BOX.lightVertical}  ${COLORS.green}RESOLUTION:${COLORS.reset} ${entry.resolution}`);
  }

  // Evidence if available (for pain points)
  if (entry.evidence && entry.evidence.length > 0) {
    lines.push(`${prefix}${BOX.lightVertical}  ${COLORS.cyan}EVIDENCE:${COLORS.reset}`);
    for (const e of entry.evidence.slice(0, 3)) { // Show max 3 evidence items
      lines.push(`${prefix}${BOX.lightVertical}    ${COLORS.dim}• ${e}${COLORS.reset}`);
    }
  }

  // Provenance if available
  if (entry.provenance) {
    const source = entry.provenance.source || 'unknown';
    const session = entry.provenance.sessionId?.slice(0, 8) || '?';
    const timestamp = entry.provenance.timestamp?.slice(0, 10) || '?';
    lines.push(`${prefix}${BOX.lightVertical}  ${COLORS.gray}Source: ${source} | Session: ${session} | ${timestamp}${COLORS.reset}`);
  }

  // Keywords if available
  if (entry.keywords && entry.keywords.length > 0) {
    lines.push(`${prefix}${BOX.lightVertical}  ${COLORS.gray}Keywords: ${entry.keywords.join(', ')}${COLORS.reset}`);
  }

  lines.push(`${prefix}${BOX.lightVertical}`);

  return lines.join('\n');
}

/**
 * Format a group of knowledge entries by dimension.
 */
export function formatDimensionGroup(dimension: Dimension, entries: KnowledgeEntryDisplay[]): string {
  const name = DIMENSION_NAMES[dimension];
  const layer = DIMENSION_LAYERS[dimension];
  const lines: string[] = [];

  lines.push(`\n${COLORS.bold}${name} (${dimension})${COLORS.reset} - ${entries.length} entries [${layer}]`);
  lines.push(`${BOX.lightTopLeft}${BOX.lightHorizontal.repeat(50)}`);

  for (const entry of entries) {
    lines.push(formatKnowledgeEntry(entry, 0));
  }

  lines.push(`${BOX.lightBottomLeft}${BOX.lightHorizontal.repeat(50)}`);

  return lines.join('\n');
}

// ============================================================================
// Progress & Status Formatting
// ============================================================================

/**
 * Format a progress bar.
 */
export function progressBar(value: number, max: number = 100, width: number = 20): string {
  const percent = Math.min(1, value / max);
  const filled = Math.round(percent * width);
  const empty = width - filled;

  const color = percent >= 0.7 ? COLORS.green : percent >= 0.4 ? COLORS.yellow : COLORS.red;

  return `${color}${'█'.repeat(filled)}${COLORS.gray}${'░'.repeat(empty)}${COLORS.reset} ${Math.round(percent * 100)}%`;
}

/**
 * Format a metric with label.
 */
export function formatMetric(label: string, value: string | number, color?: string): string {
  const colorCode = color || COLORS.white;
  return `${COLORS.dim}${label}:${COLORS.reset} ${colorCode}${value}${COLORS.reset}`;
}

// ============================================================================
// Coherence Issue Formatting
// ============================================================================

export interface CoherenceIssue {
  type: 'contradiction' | 'orphan' | 'stale' | 'gap';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  entries: string[];
  suggestion?: string;
}

/**
 * Get severity color.
 */
function severityColor(severity: CoherenceIssue['severity']): string {
  switch (severity) {
    case 'critical': return COLORS.red;
    case 'high': return COLORS.yellow;
    case 'medium': return COLORS.cyan;
    case 'low': return COLORS.gray;
  }
}

/**
 * Get severity icon.
 */
function severityIcon(severity: CoherenceIssue['severity']): string {
  switch (severity) {
    case 'critical': return '🔴';
    case 'high': return '🟠';
    case 'medium': return '🟡';
    case 'low': return '⚪';
  }
}

/**
 * Format a coherence issue.
 */
export function formatCoherenceIssue(issue: CoherenceIssue, index: number): string {
  const color = severityColor(issue.severity);
  const icon = severityIcon(issue.severity);

  const lines: string[] = [];
  lines.push(`\n${icon} ${color}Issue #${index + 1}: ${issue.type.toUpperCase()}${COLORS.reset} [${issue.severity}]`);
  lines.push(`   ${issue.description}`);

  if (issue.entries.length > 0) {
    lines.push(`   ${COLORS.dim}Affected entries: ${issue.entries.join(', ')}${COLORS.reset}`);
  }

  if (issue.suggestion) {
    lines.push(`   ${COLORS.green}Suggestion: ${issue.suggestion}${COLORS.reset}`);
  }

  return lines.join('\n');
}

/**
 * Format coherence report summary.
 */
export function formatCoherenceReport(issues: CoherenceIssue[]): string {
  if (issues.length === 0) {
    return `\n${COLORS.green}✓ No coherence issues detected. Knowledge base is consistent.${COLORS.reset}\n`;
  }

  const critical = issues.filter(i => i.severity === 'critical').length;
  const high = issues.filter(i => i.severity === 'high').length;
  const medium = issues.filter(i => i.severity === 'medium').length;
  const low = issues.filter(i => i.severity === 'low').length;

  const lines: string[] = [];
  lines.push(headerBox('Coherence Report', 60));
  lines.push(`\n${COLORS.bold}Summary:${COLORS.reset} ${issues.length} issues found`);
  lines.push(`  🔴 Critical: ${critical}  🟠 High: ${high}  🟡 Medium: ${medium}  ⚪ Low: ${low}`);

  for (let i = 0; i < issues.length; i++) {
    lines.push(formatCoherenceIssue(issues[i], i));
  }

  return lines.join('\n');
}

// ============================================================================
// Export utilities
// ============================================================================

export const colors = COLORS;
export const box = BOX;

export default {
  headerBox,
  sectionHeader,
  subHeader,
  formatTable,
  formatKnowledgeEntry,
  formatDimensionGroup,
  formatCoherenceIssue,
  formatCoherenceReport,
  confidenceBadge,
  healthStatus,
  progressBar,
  formatMetric,
  getConfidenceColor,
  colors: COLORS,
  box: BOX,
};
