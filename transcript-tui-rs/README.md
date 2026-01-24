# transcript-tui-rs

High-performance transcript viewer for Claude Code sessions, written in Rust.

This is an experimental Rust rewrite of the TypeScript `transcript-tui` from the Claude Code SDK. It provides better performance, cross-platform binaries, and no runtime dependencies.

## Features

- Two-pane layout (list + content)
- Multiple view modes (Raw, Human, Minimal, Context, Markdown)
- Vim-style navigation
- Search functionality
- Bookmarks
- Live mode (watch for new lines)
- Usage graph overlay
- Cross-platform (Linux, macOS, Windows)

## Installation

### From Releases

Download pre-built binaries from the [Releases](../../releases) page.

```bash
# Linux/macOS
tar -xzf transcript-tui-rs-<platform>.tar.gz
chmod +x transcript-tui-rs
sudo mv transcript-tui-rs /usr/local/bin/
```

### From Source

```bash
# Clone and build
git clone https://github.com/anthropics/claude-code-sdk
cd claude-code-sdk/transcript-tui-rs
cargo build --release

# Install
cargo install --path crates/transcript-tui
```

## Usage

```bash
# View a session by name
transcript-tui-rs tender-spider

# View a session by ID
transcript-tui-rs abc-123-def-456

# Start in live mode
transcript-tui-rs -l tender-spider

# Specify view mode (1=Raw, 2=Human, 3=Minimal, 4=Context, 5=Markdown)
transcript-tui-rs -m 1 tender-spider

# Show database statistics
transcript-tui-rs --stats

# List recent sessions
transcript-tui-rs --list
```

## Key Bindings

| Key | Action |
|-----|--------|
| `j`/`k`, `↑`/`↓` | Move selection |
| `g`/`G` | Go to first/last line |
| `PgUp`/`PgDn` | Page up/down |
| `Tab` | Switch panes |
| `1`-`5` | Change view mode |
| `f` | Toggle fullscreen |
| `/` | Start search |
| `n`/`N` | Next/prev search result |
| `Space` | Toggle bookmark |
| `[`/`]` | Prev/next bookmark |
| `u` | Toggle usage graph |
| `L` | Toggle live mode |
| `?` | Show help |
| `q`, `Esc` | Quit |

## Requirements

This tool reads from the Claude Code SDK transcript database at `~/.claude-code-sdk/transcripts.db`. Make sure you have built the index first:

```bash
# From the claude-code-sdk directory
bun run transcript index build
```

## Architecture

```
crates/
├── transcript-core/    # Core types and business logic
├── transcript-db/      # SQLite database layer
├── transcript-ui/      # TUI components (ratatui)
└── transcript-tui/     # Main binary
```

## License

MIT
