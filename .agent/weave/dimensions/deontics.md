# Δ - Deontics (Rules & Obligations)

**Type:** Obligations, permissions, prohibitions
**Collections:** obligations, permissions, prohibitions
**Count:** 4 obligations, 2 permissions, 3 prohibitions

## Key Insights

### MUST (Obligations)

**1. MUST test before commit**
- Scope: All implementations, especially after agent delegation
- Enforcement: Run monitor, validate JSON, verify functionality before marking todos complete
- Violations: Telling user "feature complete, please test" without evidence

**2. MUST preserve context for oversight**
- Scope: Complex features when context >80% used
- Enforcement: Use Task tool with specialized agents (backend-dev, frontend-dev, spec-writer)
- Violations: Implementing everything yourself when context is limited

**3. MUST ask clarifying questions**
- Scope: All work, especially design decisions with multiple valid approaches
- Enforcement: Use AskUserQuestion tool before finalizing plans
- Violations: Guessing at user intent, making assumptions about semantics

**4. MUST validate JSON dimension files**
- Scope: Weave dimension files (*.json in .agent/weave/)
- Enforcement: Run node JSON.parse validation before commit
- Violations: Committing without JSON validation

### MAY (Permissions)

**1. MAY defer Phase 2 to later**
- Scope: Multi-phase projects where phases can be tested independently
- Conditions: Phase 1 complete and testable, context budget concern, user agrees

**2. MAY use agent delegation for context**
- Scope: Complex implementations, multiple file types, context >80%
- Conditions: Work divisible into logical units, agents have appropriate expertise

### MUST NOT (Prohibitions)

**1. MUST NOT assume dimension semantics**
- Scope: Adding new knowledge dimensions
- Alternatives: Use AskUserQuestion to get user's intended semantics

**2. MUST NOT commit untested features**
- Scope: All commits, especially after agent delegation or complex changes
- Alternatives: Test monitor, validate JSON, verify behavior, THEN commit

**3. MUST NOT use MCP when Skills sufficient**
- Scope: Progressive disclosure, knowledge loading, tool selection
- Alternatives: Use Skills with markdown sharding
- Rationale: User prefers MCP sparingly, Skills is simpler and native

## When to Query Full Dimension

- Understanding project rules
- Checking obligations before work
- Verifying permissions for approach
- Learning prohibitions to avoid

## Query Commands

```bash
# Get obligation details
bun .agent/weave/scripts/query.ts deontics:must-test-before-commit

# Search prohibitions
bun .agent/weave/scripts/search.ts --dimension=Δ "MUST NOT"

# Get all obligations
cat .agent/weave/deontics.json | jq '.obligations'
```

---
*Shard: ~800 tokens | Full: ~1.6K tokens | Load full for: rule verification, obligation checking, prohibition awareness*
