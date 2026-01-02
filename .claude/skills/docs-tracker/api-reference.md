# DocsTracker API Reference

## DocsTracker Class

Main class for tracking Claude Code documentation.

### Constructor

```typescript
new DocsTracker(config?: Partial<DocsTrackerConfig>)
```

### Configuration

```typescript
interface DocsTrackerConfig {
  cacheDir: string;       // Default: '.claude-code-sdk/docs-cache'
  baseUrl: string;        // Default: 'https://code.claude.com/docs/en'
  checkInterval: number;  // Hours between checks, default: 24
  autoFetch: boolean;     // Auto-fetch on startup, default: false
  fetchTimeout: number;   // Fetch timeout in ms, default: 30000
}
```

## Methods

### Initialization

#### `init(): Promise<void>`
Initialize the tracker, load existing cache and metadata.

### Fetching

#### `fetchDoc(url: string, category?: DocCategory): Promise<FetchResult>`
Fetch and cache a single document.

#### `fetchAll(): Promise<BatchResult>`
Fetch all registered documentation sources.

### Delta Detection

#### `checkForChanges(url: string): Promise<DeltaResult>`
Check a single document for changes without downloading.

#### `checkAllForChanges(): Promise<DeltaResult[]>`
Check all documents for changes.

### Querying

#### `getCachedContent(url: string): Promise<string | null>`
Get cached content for a URL.

#### `getMetadata(url: string): DocMetadata | undefined`
Get metadata for a cached document.

#### `getAllMetadata(): DocMetadata[]`
Get all cached document metadata.

#### `getByCategory(category: DocCategory): DocMetadata[]`
Get documents by category.

#### `getByTag(tag: string): DocMetadata[]`
Get documents by tag.

#### `getChangedDocs(): DocMetadata[]`
Get documents that have changed since first cached.

#### `searchContent(query: string): Promise<Array<{url: string; matches: string[]}>>`
Search cached docs by content.

### Index & Status

#### `generateIndex(): Promise<DocsIndex>`
Generate a documentation index.

#### `getCacheStatus(): Promise<CacheStatus>`
Get cache statistics.

### Management

#### `clearCache(): Promise<void>`
Clear the documentation cache.

#### `getSources(): DocSource[]`
Get all registered doc sources.

#### `addSource(source: DocSource): void`
Add a custom doc source.

## Types

### DocCategory

```typescript
type DocCategory =
  | 'core'
  | 'development'
  | 'configuration'
  | 'integration'
  | 'reference'
  | 'enterprise'
  | 'ide'
  | 'cicd'
  | 'troubleshooting';
```

### DocMetadata

```typescript
interface DocMetadata {
  url: string;
  localPath: string;
  title: string;
  description: string;
  category: DocCategory;
  tags: string[];
  contentHash: string;      // SHA-256 hash
  firstCached: Date;
  lastFetched: Date;
  lastChanged: Date | null;
  version: number;          // Increments on each change
}
```

### DeltaResult

```typescript
interface DeltaResult {
  url: string;
  hasChanges: boolean;
  previousHash: string;
  newHash: string;
  checkedAt: Date;
  diffSummary?: DiffSummary;
}
```

### DiffSummary

```typescript
interface DiffSummary {
  linesAdded: number;
  linesRemoved: number;
  linesModified: number;
  changedSections: string[];  // Changed headings
  summary: string;            // e.g., "+10/-5 lines, 2 new sections"
}
```

### FetchResult

```typescript
interface FetchResult {
  url: string;
  success: boolean;
  content?: string;
  error?: string;
  fetchedAt: Date;
  responseTime: number;
}
```

### BatchResult

```typescript
interface BatchResult {
  totalDocs: number;
  successCount: number;
  failureCount: number;
  changesDetected: number;
  results: FetchResult[];
  duration: number;
}
```

### CacheStatus

```typescript
interface CacheStatus {
  totalDocs: number;
  docsWithChanges: number;
  lastFullUpdate: Date | null;
  cacheSizeBytes: number;
  oldestDoc: Date | null;
  newestDoc: Date | null;
}
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `bun run docs` | Show help |
| `bun run docs:fetch` | Fetch all docs |
| `bun run docs:check` | Check for changes |
| `bun run docs:status` | Show cache status |
| `bun run docs list` | List all docs |
| `bun run docs list <category>` | List docs by category |
| `bun run docs search <query>` | Search content |
| `bun run docs index` | Generate index |
| `bun run docs clear` | Clear cache |
| `bun run docs diff <url>` | Show diff for URL |
