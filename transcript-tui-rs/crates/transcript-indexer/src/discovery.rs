//! File discovery for transcript and hook event JSONL files

use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// Default projects directory (~/.claude/projects)
pub fn default_projects_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "~".to_string());
    PathBuf::from(home).join(".claude").join("projects")
}

/// Default hooks directory (~/.claude/hooks)
pub fn default_hooks_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "~".to_string());
    PathBuf::from(home).join(".claude").join("hooks")
}

/// Find all transcript JSONL files (excluding *.hooks.jsonl)
pub fn find_transcript_files(dir: Option<&Path>) -> Vec<PathBuf> {
    let dir = dir
        .map(PathBuf::from)
        .unwrap_or_else(default_projects_dir);

    if !dir.exists() {
        return Vec::new();
    }

    let mut files = Vec::new();
    for entry in WalkDir::new(&dir)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                // Include .jsonl files but exclude .hooks.jsonl files
                if name.ends_with(".jsonl") && !name.ends_with(".hooks.jsonl") {
                    files.push(path.to_path_buf());
                }
            }
        }
    }

    files.sort();
    files
}

/// Find all hook event JSONL files (*.hooks.jsonl)
pub fn find_hook_files(dir: Option<&Path>) -> Vec<PathBuf> {
    let dir = dir.map(PathBuf::from).unwrap_or_else(default_hooks_dir);

    if !dir.exists() {
        return Vec::new();
    }

    let mut files = Vec::new();
    for entry in WalkDir::new(&dir)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.ends_with(".hooks.jsonl") {
                    files.push(path.to_path_buf());
                }
            }
        }
    }

    files.sort();
    files
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_find_transcript_files_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let files = find_transcript_files(Some(tmp.path()));
        assert!(files.is_empty());
    }

    #[test]
    fn test_find_transcript_files_filters_hooks() {
        let tmp = tempfile::tempdir().unwrap();
        let project_dir = tmp.path().join("project1");
        fs::create_dir_all(&project_dir).unwrap();

        // Create transcript file
        fs::write(project_dir.join("transcript.jsonl"), "{}").unwrap();
        // Create hooks file (should be excluded)
        fs::write(project_dir.join("events.hooks.jsonl"), "{}").unwrap();
        // Create non-jsonl file (should be excluded)
        fs::write(project_dir.join("readme.txt"), "hello").unwrap();

        let files = find_transcript_files(Some(tmp.path()));
        assert_eq!(files.len(), 1);
        assert!(files[0].to_string_lossy().contains("transcript.jsonl"));
    }

    #[test]
    fn test_find_hook_files() {
        let tmp = tempfile::tempdir().unwrap();
        let hooks_dir = tmp.path().join("hooks");
        fs::create_dir_all(&hooks_dir).unwrap();

        fs::write(hooks_dir.join("session.hooks.jsonl"), "{}").unwrap();
        fs::write(hooks_dir.join("transcript.jsonl"), "{}").unwrap();

        let files = find_hook_files(Some(tmp.path()));
        assert_eq!(files.len(), 1);
        assert!(files[0]
            .to_string_lossy()
            .contains("session.hooks.jsonl"));
    }

    #[test]
    fn test_find_transcript_files_nonexistent_dir() {
        let files = find_transcript_files(Some(Path::new("/nonexistent/path")));
        assert!(files.is_empty());
    }
}
