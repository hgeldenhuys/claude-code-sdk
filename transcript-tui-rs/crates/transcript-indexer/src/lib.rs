//! transcript-indexer - Indexing pipeline for Claude Code transcript database
//!
//! This crate owns all **write** operations to the transcript SQLite database.
//! The companion `transcript-db` crate provides read-only access for TUI/query paths.
//! Both share the same `~/.claude-code-sdk/transcripts.db` file.

pub mod adapter;
pub mod connection;
pub mod content_trimmer;
pub mod correlation;
pub mod daemon;
pub mod discovery;
pub mod hook_indexer;
pub mod indexer;
pub mod rebuild;
pub mod schema;
pub mod text_extract;

pub use connection::IndexerDb;
pub use correlation::{correlate_lines_to_turns, CorrelationResult};
pub use daemon::IndexerDaemon;
pub use discovery::{find_hook_files, find_transcript_files};
pub use hook_indexer::{index_all_hook_files, index_hook_file, update_hook_index, HookIndexResult};
pub use indexer::{index_all_transcripts, index_transcript_file, update_transcripts, IndexResult};
pub use rebuild::rebuild_index;
pub use schema::{init_schema, migrate_schema, DB_VERSION};
