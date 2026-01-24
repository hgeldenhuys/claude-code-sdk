# Reference Implementation

Minimal working example demonstrating rust-cli skill patterns.

## Structure

```
reference/
├── Cargo.toml          # Workspace manifest
└── crates/
    ├── core/           # Types and errors (no I/O)
    │   └── src/
    │       ├── lib.rs
    │       ├── types.rs
    │       └── errors.rs
    └── cli/            # Binary with clap
        └── src/
            ├── main.rs
            └── cli.rs
```

## Build

```bash
cargo build --release
```

## Run

```bash
# Show help
cargo run -- --help

# Run doctor
cargo run -- --doctor

# Run with input
cargo run -- my-input

# With verbose
cargo run -- -v my-input
```

## Key Patterns Demonstrated

1. **Workspace structure** - Core crate with no CLI dependencies
2. **Clap derive** - Type-safe argument parsing
3. **thiserror** - Domain errors in core crate
4. **anyhow** - Error context in CLI crate
5. **Early-exit commands** - `--help`, `--doctor`, `--list`
6. **Colorblind output** - Symbols + colors for status
7. **Builder pattern** - Fluent configuration
