/**
 * Types for the Claude Code Documentation Tracker
 */

/**
 * Categories of Claude Code documentation
 */
export type DocCategory =
  | 'core' // Getting started, overview, quickstart
  | 'development' // Hooks, skills, subagents, plugins
  | 'configuration' // Settings, memory, model config
  | 'integration' // MCP, third-party, Bedrock, Vertex
  | 'reference' // CLI, slash commands, plugins reference
  | 'enterprise' // Security, networking, IAM
  | 'ide' // VS Code, JetBrains, desktop
  | 'cicd' // GitHub Actions, GitLab CI
  | 'troubleshooting'; // Troubleshooting, common issues

/**
 * Metadata for a cached documentation page
 */
export interface DocMetadata {
  /** Full URL of the documentation page */
  url: string;
  /** Local path where the doc is cached */
  localPath: string;
  /** Document title extracted from content */
  title: string;
  /** Brief description of the document */
  description: string;
  /** Category for organization */
  category: DocCategory;
  /** Tags for filtering */
  tags: string[];
  /** SHA-256 hash of the content for delta detection */
  contentHash: string;
  /** When the doc was first cached */
  firstCached: Date;
  /** When the doc was last fetched */
  lastFetched: Date;
  /** When changes were last detected */
  lastChanged: Date | null;
  /** Version counter - incremented on each detected change */
  version: number;
}

/**
 * Result of a delta check between cached and live content
 */
export interface DeltaResult {
  /** URL of the document */
  url: string;
  /** Whether changes were detected */
  hasChanges: boolean;
  /** Previous content hash */
  previousHash: string;
  /** New content hash */
  newHash: string;
  /** When the check was performed */
  checkedAt: Date;
  /** Diff summary if changes detected */
  diffSummary?: DiffSummary;
}

/**
 * Summary of differences between cached and live content
 */
export interface DiffSummary {
  /** Number of lines added */
  linesAdded: number;
  /** Number of lines removed */
  linesRemoved: number;
  /** Number of lines modified */
  linesModified: number;
  /** Sections that changed (based on headings) */
  changedSections: string[];
  /** Brief description of changes */
  summary: string;
}

/**
 * A recorded delta event for history tracking
 */
export interface DeltaRecord {
  /** Unique ID for this delta */
  id: string;
  /** URL of the document */
  url: string;
  /** Document title at time of change */
  title: string;
  /** When the change was detected */
  detectedAt: Date;
  /** Previous version number */
  previousVersion: number;
  /** New version number */
  newVersion: number;
  /** Previous content hash */
  previousHash: string;
  /** New content hash */
  newHash: string;
  /** Diff summary */
  diffSummary: DiffSummary;
  /** Whether this delta has been reviewed */
  reviewed: boolean;
}

/**
 * Delta history storage
 */
export interface DeltaHistory {
  /** Schema version for migrations */
  schemaVersion: string;
  /** All recorded deltas */
  deltas: DeltaRecord[];
}

/**
 * Index entry for the documentation catalog
 */
export interface DocIndexEntry {
  url: string;
  title: string;
  description: string;
  category: DocCategory;
  tags: string[];
  lastFetched: Date;
  hasUnreviewedChanges: boolean;
}

/**
 * Full documentation index
 */
export interface DocsIndex {
  /** Version of the index schema */
  schemaVersion: string;
  /** When the index was last updated */
  lastUpdated: Date;
  /** Base URL for documentation */
  baseUrl: string;
  /** All indexed documents */
  documents: DocIndexEntry[];
  /** Categories with document counts */
  categories: Record<DocCategory, number>;
}

/**
 * Configuration for the DocsTracker
 */
export interface DocsTrackerConfig {
  /** Directory to store cached docs */
  cacheDir: string;
  /** Base URL for fetching docs */
  baseUrl: string;
  /** How often to check for updates (hours) */
  checkInterval: number;
  /** Whether to auto-fetch on startup */
  autoFetch: boolean;
  /** Timeout for fetch operations (ms) */
  fetchTimeout: number;
}

/**
 * Status of the docs cache
 */
export interface CacheStatus {
  /** Total number of cached documents */
  totalDocs: number;
  /** Number of docs with unreviewed changes */
  docsWithChanges: number;
  /** When the cache was last updated */
  lastFullUpdate: Date | null;
  /** Disk space used by cache */
  cacheSizeBytes: number;
  /** Oldest document in cache */
  oldestDoc: Date | null;
  /** Newest document in cache */
  newestDoc: Date | null;
}

/**
 * Result of a fetch operation
 */
export interface FetchResult {
  url: string;
  success: boolean;
  content?: string;
  error?: string;
  fetchedAt: Date;
  responseTime: number;
}

/**
 * Batch operation result
 */
export interface BatchResult {
  totalDocs: number;
  successCount: number;
  failureCount: number;
  changesDetected: number;
  results: FetchResult[];
  duration: number;
}

/**
 * Document source definition for tracking
 */
export interface DocSource {
  /** Unique identifier */
  id: string;
  /** Full URL */
  url: string;
  /** Category assignment */
  category: DocCategory;
  /** Tags for filtering */
  tags: string[];
  /** Priority (1-10, higher = more important) */
  priority: number;
}

/**
 * Predefined Claude Code documentation sources
 */
export const CLAUDE_CODE_DOCS: DocSource[] = [
  // Core Development
  {
    id: 'hooks',
    url: 'https://code.claude.com/docs/en/hooks.md',
    category: 'development',
    tags: ['hooks', 'automation', 'events'],
    priority: 10,
  },
  {
    id: 'hooks-guide',
    url: 'https://code.claude.com/docs/en/hooks-guide.md',
    category: 'development',
    tags: ['hooks', 'guide', 'examples'],
    priority: 9,
  },
  {
    id: 'skills',
    url: 'https://code.claude.com/docs/en/skills.md',
    category: 'development',
    tags: ['skills', 'agents', 'capabilities'],
    priority: 10,
  },
  {
    id: 'sub-agents',
    url: 'https://code.claude.com/docs/en/sub-agents.md',
    category: 'development',
    tags: ['agents', 'subagents', 'delegation'],
    priority: 10,
  },
  {
    id: 'plugins',
    url: 'https://code.claude.com/docs/en/plugins.md',
    category: 'development',
    tags: ['plugins', 'extensions', 'marketplace'],
    priority: 10,
  },
  {
    id: 'plugins-reference',
    url: 'https://code.claude.com/docs/en/plugins-reference.md',
    category: 'reference',
    tags: ['plugins', 'api', 'schema'],
    priority: 9,
  },
  {
    id: 'plugin-marketplaces',
    url: 'https://code.claude.com/docs/en/plugin-marketplaces.md',
    category: 'development',
    tags: ['plugins', 'marketplace', 'distribution', 'hosting'],
    priority: 9,
  },
  {
    id: 'headless',
    url: 'https://code.claude.com/docs/en/headless.md',
    category: 'development',
    tags: ['headless', 'automation', 'programmatic'],
    priority: 8,
  },
  {
    id: 'mcp',
    url: 'https://code.claude.com/docs/en/mcp.md',
    category: 'integration',
    tags: ['mcp', 'tools', 'protocol'],
    priority: 9,
  },

  // Configuration
  {
    id: 'settings',
    url: 'https://code.claude.com/docs/en/settings.md',
    category: 'configuration',
    tags: ['settings', 'config', 'preferences'],
    priority: 8,
  },
  {
    id: 'memory',
    url: 'https://code.claude.com/docs/en/memory.md',
    category: 'configuration',
    tags: ['memory', 'context', 'persistence'],
    priority: 7,
  },
  {
    id: 'model-config',
    url: 'https://code.claude.com/docs/en/model-config.md',
    category: 'configuration',
    tags: ['models', 'config', 'aliases'],
    priority: 7,
  },
  {
    id: 'terminal-config',
    url: 'https://code.claude.com/docs/en/terminal-config.md',
    category: 'configuration',
    tags: ['terminal', 'shell', 'setup'],
    priority: 6,
  },
  {
    id: 'output-styles',
    url: 'https://code.claude.com/docs/en/output-styles.md',
    category: 'configuration',
    tags: ['output', 'formatting', 'styles'],
    priority: 5,
  },
  {
    id: 'statusline',
    url: 'https://code.claude.com/docs/en/statusline.md',
    category: 'configuration',
    tags: ['statusline', 'ui', 'display'],
    priority: 4,
  },

  // Reference
  {
    id: 'cli-reference',
    url: 'https://code.claude.com/docs/en/cli-reference.md',
    category: 'reference',
    tags: ['cli', 'commands', 'flags'],
    priority: 9,
  },
  {
    id: 'slash-commands',
    url: 'https://code.claude.com/docs/en/slash-commands.md',
    category: 'reference',
    tags: ['commands', 'slash', 'shortcuts'],
    priority: 8,
  },
  {
    id: 'interactive-mode',
    url: 'https://code.claude.com/docs/en/interactive-mode.md',
    category: 'reference',
    tags: ['interactive', 'keyboard', 'ui'],
    priority: 7,
  },
  {
    id: 'checkpointing',
    url: 'https://code.claude.com/docs/en/checkpointing.md',
    category: 'reference',
    tags: ['checkpoints', 'undo', 'history'],
    priority: 6,
  },

  // Enterprise/Integration
  {
    id: 'third-party-integrations',
    url: 'https://code.claude.com/docs/en/third-party-integrations.md',
    category: 'enterprise',
    tags: ['enterprise', 'integrations', 'deployment'],
    priority: 7,
  },
  {
    id: 'amazon-bedrock',
    url: 'https://code.claude.com/docs/en/amazon-bedrock.md',
    category: 'integration',
    tags: ['aws', 'bedrock', 'cloud'],
    priority: 7,
  },
  {
    id: 'network-config',
    url: 'https://code.claude.com/docs/en/network-config.md',
    category: 'enterprise',
    tags: ['network', 'proxy', 'enterprise'],
    priority: 6,
  },
  {
    id: 'llm-gateway',
    url: 'https://code.claude.com/docs/en/llm-gateway.md',
    category: 'enterprise',
    tags: ['gateway', 'routing', 'enterprise'],
    priority: 6,
  },

  // IDE / Browser Integration
  {
    id: 'chrome',
    url: 'https://code.claude.com/docs/en/chrome.md',
    category: 'ide',
    tags: ['chrome', 'browser', 'extension', 'automation'],
    priority: 7,
  },

  // Troubleshooting
  {
    id: 'troubleshooting',
    url: 'https://code.claude.com/docs/en/troubleshooting.md',
    category: 'troubleshooting',
    tags: ['troubleshooting', 'errors', 'help'],
    priority: 8,
  },

  // Release Notes / Changelog
  {
    id: 'changelog',
    url: 'https://raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md',
    category: 'core',
    tags: ['changelog', 'releases', 'breaking-changes', 'new-features'],
    priority: 10,
  },

  // Platform Claude Docs - Agent Skills (docs.claude.com)
  {
    id: 'skills-overview',
    url: 'https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview',
    category: 'development',
    tags: ['skills', 'agents', 'overview', 'architecture'],
    priority: 10,
  },
  {
    id: 'skills-best-practices',
    url: 'https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices',
    category: 'development',
    tags: ['skills', 'best-practices', 'authoring', 'patterns'],
    priority: 10,
  },
  {
    id: 'skills-quickstart',
    url: 'https://docs.claude.com/en/docs/agents-and-tools/agent-skills/quickstart',
    category: 'development',
    tags: ['skills', 'quickstart', 'tutorial', 'getting-started'],
    priority: 9,
  },
  {
    id: 'claude-4-best-practices',
    url: 'https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/claude-4-best-practices',
    category: 'reference',
    tags: ['claude-4', 'opus', 'prompting', 'best-practices'],
    priority: 8,
  },
  {
    id: 'agent-sdk-overview',
    url: 'https://docs.claude.com/en/docs/agents-and-tools/claude-code/sdk-overview',
    category: 'development',
    tags: ['sdk', 'agents', 'programmatic', 'typescript', 'python'],
    priority: 9,
  },
];
