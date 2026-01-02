---
description: Load accumulated knowledge from previous sessions (manual SessionStart)
---

Load the knowledge fabric from previous sessions and inject it into this conversation.

This is the same operation that runs automatically via the SessionStart hook, but you can trigger it manually:
- If hooks are broken or disabled
- To refresh knowledge mid-session
- To verify what Weave has learned

**Instructions:**

1. Check if Weave is installed: `.agent/weave/` directory exists
2. If not installed, tell user: "Weave not installed. Run: `bun .agent/weave/weave.ts install`"
3. Load the knowledge fabric:
   - Read `.agent/weave/ontology.json`
   - Read `.agent/weave/epistemology.json`
   - Read `.agent/weave/mereology.json`
   - Read `.agent/weave/qualia.json`
   - Read `.agent/weave/meta.json`

4. Filter for high-confidence knowledge (confidence ≥ 0.85):
   - Top 10 entities from ontology
   - Top 8 knowledge concepts from epistemology
   - Top 6 architectural patterns
   - Top 5 pain points from qualia
   - Top 6 best practices from qualia

5. Format and display the knowledge fabric:

```markdown
# 🌊 Weave: Project Knowledge Fabric

This project has accumulated knowledge from **{totalSessions}** previous sessions.
System Health: {epistemicConfidence}% epistemic confidence, {ontologyCoverage}% ontology coverage.

---

## 🧠 What Exists (Ontology)
{totalEntities} entities identified, {totalRelations} relations mapped

{Top 10 high-confidence entities with descriptions}

---

## 📚 How We Know (Epistemology)
{totalKnowledgeConcepts} knowledge concepts, {totalPatterns} patterns, {totalValidations} validations

### Knowledge Concepts:
{Top 8 knowledge concepts with descriptions and evidence}

### Architectural Patterns:
{Top 6 patterns with descriptions}

---

## 🏗️ How It Composes (Mereology)
{totalComponents} components, {totalCompositions} compositions

{Top 5 component compositions}

---

## 🎭 What We've Learned (Qualia)
{totalPainPoints} pain points, experience from {totalSessions} sessions

### Pain Points (Avoid These):
{Top 5 pain points with resolutions}

### Best Practices:
{Top 6 best practices with rationale}

---

**Note**: This knowledge was automatically extracted and validated across multiple sessions. Confidence scores reflect evidence strength and validation history.
```

6. If no knowledge exists (first session):
   - Tell user: "This is the first session - no accumulated knowledge yet"
   - Explain how knowledge will be captured as they work

**Important:**
- Only show high-confidence knowledge (≥0.85)
- Limit items to prevent context bloat
- Format clearly with markdown sections
- Include metadata stats for transparency
