# Rust CLI Migration Recipe

Spec for migrating TypeScript Bun CLIs to self-contained Rust binaries. This document describes the completed transcript CLI migration and serves as the recipe for future migrations (hook-events, etc.).

## Overview

| Aspect | Before | After |
|--------|--------|-------|
| Runtime | Bun (bun:sqlite) | Native binary (rusqlite) |
| Build | None (interpreted) | `cargo build --release` |
| DB access | bun:sqlite (Bun-only) | rusqlite (portable) |
| Install | `bun install` | `cargo build --release` |
| Binary | `bun bin/transcript.ts` | `target/release/transcript` |

## Architecture

```
transcript-tui-rs/               # Cargo workspace root
├── Cargo.toml                   # Workspace manifest
├── crates/
│   ├── transcript-core/         # Types, enums, no I/O
│   │   └── src/lib.rs          # TranscriptLine, LineType, SessionInfo
│   ├── transcript-db/           # Read-only queries
│   │   └── src/
│   │       ├── connection.rs   # TranscriptDb (SQLITE_OPEN_READ_ONLY)
│   │       ├── queries.rs      # get_lines, search_lines (FTS)
│   │       └── sessions.rs     # resolve_session, get_sessions
│   ├── transcript-indexer/      # Write operations (NEW)
│   │   └── src/
│   │       ├── connection.rs   # IndexerDb (READ_WRITE | CREATE, WAL)
│   │       ├── schema.rs       # CREATE TABLE, FTS5, triggers, migrations
│   │       ├── discovery.rs    # find_transcript_files, find_hook_files
│   │       ├── text_extract.rs # extract_searchable_text (ported from TS)
│   │       ├── indexer.rs      # index transcript JSONL -> lines table
│   │       ├── hook_indexer.rs # index hook JSONL -> hook_events table
│   │       ├── correlation.rs  # correlate transcript lines with turns
│   │       ├── rebuild.rs      # drop + recreate all tables
│   │       ├── daemon.rs       # file watcher (notify crate)
│   │       └── adapter.rs      # Adapter trait for extensibility
│   └── transcript-cli/          # Binary crate
│       └── src/
│           ├── main.rs         # Entry point, command routing
│           ├── cli.rs          # Clap derive structs
│           ├── commands/       # Command implementations
│           │   ├── list.rs
│           │   ├── info.rs
│           │   ├── view.rs
│           │   ├── search.rs
│           │   ├── recall.rs   # FTS across lines + hooks, grouped by session
│           │   ├── index.rs    # build, update, rebuild, watch, status
│           │   └── doctor.rs
│           └── output/         # Formatting
│               ├── colors.rs
│               ├── human.rs
│               └── json.rs
```

## Crate Separation Pattern

```
transcript-core       (types only, no deps)
       │
       ├──────────────────┐
       │                  │
transcript-db         transcript-indexer
(read-only queries)   (write operations)
       │                  │
       └──────────────────┘
              │
       transcript-cli
       (binary, routes commands)
```

- **core**: Zero-dependency types shared by all crates
- **db**: Opens `SQLITE_OPEN_READ_ONLY` for query commands (list, view, search, info)
- **indexer**: Opens `READ_WRITE | CREATE` + WAL mode for index commands (build, update, rebuild, watch, recall)
- **cli**: Binary that routes commands to the appropriate crate

## Migration Steps (Recipe)

### 1. Create the Indexer Crate

This is the core of the migration. The indexer owns all **write** operations to the SQLite database.

**Port order:**
1. `connection.rs` - Read-write DB with WAL mode
2. `schema.rs` - All CREATE TABLE, FTS5 virtual tables, triggers, migrations
3. `discovery.rs` - File discovery with walkdir
4. `text_extract.rs` - Extract searchable text from JSONL entries
5. `indexer.rs` - Index transcript JSONL files with byte-offset delta
6. `hook_indexer.rs` - Index hook event JSONL files
7. `correlation.rs` - Correlate transcript lines with turn data from hooks
8. `rebuild.rs` - Drop and recreate all tables
9. `daemon.rs` - File watcher with notify crate
10. `adapter.rs` - Trait for extensible indexing

**Critical details:**
- Schema must produce **identical** SQLite database to the TS version (same tables, columns, indexes, FTS config)
- Use `INSERT OR REPLACE` for idempotent indexing
- Byte-offset tracking in `sessions`/`hook_files` tables enables delta updates
- FTS5 uses content-synced tables for `lines_fts` and standalone for `hook_events_fts`
- Text extraction must handle multi-byte UTF-8 (use `is_char_boundary()` for truncation)

### 2. Wire CLI Commands

Add the indexer crate as a dependency of transcript-cli and route commands:

| Command | Uses | DB Mode |
|---------|------|---------|
| `list`, `view`, `info`, `search` | transcript-db | Read-only |
| `index build/update/rebuild/watch` | transcript-indexer | Read-write |
| `index status`, `doctor` | transcript-db (optional) | Read-only |
| `recall` | transcript-indexer | Read-write |

Commands that use the indexer should be routed **before** the `let db = db?;` line in main.rs so they don't fail when the read-only DB doesn't exist yet.

### 3. Update Project Integration

1. **Remove TS bin entries** from `package.json`
2. **Update scripts** to point to Rust binary: `transcript-tui-rs/target/release/transcript`
3. **Update install-hooks.sh**:
   - Add `cargo build --release` step after cloning
   - Create wrapper: `.claude/bin/transcript` -> Rust binary
4. **Update CI** (`.github/workflows/ci.yml`):
   - Add `dtolnay/rust-toolchain@stable`
   - Add `Swatinem/rust-cache@v2` for caching
   - Add `cargo build --release -p <crate>` step
   - Test with `target/release/<binary> --help`
5. **Move TS files** to backup directory

### 4. Verify

```bash
# Build
cargo build --release -p transcript-cli

# Schema compatibility
transcript index build          # Full build
transcript index status         # Verify v8 schema, counts

# Delta updates
transcript index update         # Only new content

# Search
transcript search "keyword"     # FTS search
transcript recall "keyword"     # Grouped by session

# CLI parity
transcript list                 # Recent sessions
transcript info <session>       # Session details
transcript view <session>       # View lines
```

## Output Format Convention

All commands support three output formats via `--format` / `--json` / `--human` / `--minimal`:

| Format | When | Purpose |
|--------|------|---------|
| Human | TTY detected | Colored, formatted for terminal |
| JSON | Pipe / non-TTY | Machine-readable, one object or array |
| Minimal | `--minimal` flag | Content only, no decoration |

Auto-detection: human if stdout is a TTY, JSON otherwise.

## Key Dependencies

| Crate | Purpose |
|-------|---------|
| `rusqlite` | SQLite with FTS5, bundled feature |
| `clap` | CLI argument parsing (derive) |
| `serde_json` | JSONL parsing |
| `chrono` | Timestamp handling |
| `walkdir` | Recursive directory traversal |
| `notify` | File system watching |
| `notify-debouncer-mini` | Debounce file change events |
| `colored` | Terminal colors |
| `anyhow` | Error handling in CLI |
| `thiserror` | Error types in libraries |

## SQLite Schema (v8)

```sql
-- Core tables
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  uuid TEXT NOT NULL,
  parent_uuid TEXT,
  line_number INTEGER NOT NULL,
  type TEXT NOT NULL,
  subtype TEXT,
  timestamp TEXT NOT NULL,
  slug TEXT,
  role TEXT,
  model TEXT,
  cwd TEXT,
  content TEXT,
  raw TEXT NOT NULL,
  file_path TEXT NOT NULL,
  turn_id TEXT,
  turn_sequence INTEGER,
  session_name TEXT,
  git_hash TEXT,
  git_branch TEXT,
  UNIQUE(session_id, uuid)
);
CREATE VIRTUAL TABLE lines_fts USING fts5(content, content=lines, content_rowid=id);

-- Hook events
CREATE TABLE hook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  event_type TEXT NOT NULL,
  tool_name TEXT,
  tool_use_id TEXT,
  decision TEXT,
  input_json TEXT,
  context_json TEXT,
  file_path TEXT NOT NULL,
  line_number INTEGER NOT NULL,
  turn_id TEXT,
  turn_sequence INTEGER,
  session_name TEXT,
  git_hash TEXT,
  git_branch TEXT,
  git_dirty INTEGER,
  handler_results_json TEXT
);
CREATE VIRTUAL TABLE hook_events_fts USING fts5(content, content='', content_rowid=id);

-- Tracking tables
CREATE TABLE sessions (file_path TEXT PRIMARY KEY, session_id TEXT, ...);
CREATE TABLE hook_files (file_path TEXT PRIMARY KEY, session_id TEXT, ...);
CREATE TABLE adapter_cursors (file_path TEXT, adapter_name TEXT, ...);
```

## Applying This Recipe to hook-events CLI

To migrate `bin/hook-events.ts` and `bin/hook-events-tui.ts`:

1. Create `crates/hook-events-cli/` with same structure as transcript-cli
2. Reuse `transcript-db` for read queries (hook events are in the same DB)
3. Reuse `transcript-indexer` for any write operations
4. Port the hook-events-specific output formatting (event abbreviations, tool views, context usage %)
5. Port the TUI (consider using `ratatui` instead of Cursive)
6. Update package.json, install-hooks.sh, CI workflow
7. Move TS files to backup

The indexer is already done - hook-events CLI only needs the **query** side.
