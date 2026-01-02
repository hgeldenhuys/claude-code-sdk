---
description: Transform rough feature idea into detailed story with acceptance criteria (delegates to architect)
---

# /loom:ideate - Transform Feature Idea into Story

## Purpose

Transform a rough feature idea into a detailed, testable story by delegating analysis work to the architect agent.

**Stage Manager Role:** Coordination only - spawn architect, save output via Board CLI.

**Architect Role:** All analysis work - extract WHY, define acceptance criteria, make design decisions.

## Board CLI Integration (Required)

This command uses **Trak Board CLI exclusively** for story storage. No file-based storage.

**Board CLI Commands:**
```bash
# Check if feature exists
board feature show ${CODE} --json

# Create feature
board feature create -c ${CODE} -n "Name" -d "Description"

# Create story
board story create -f ${CODE} -t "Title" -w "Why" -d "Description" -s planned -p P1

# Add acceptance criteria
board ac add -s ${STORY_ID} -d "Description" -c AC-001
```

## Input

```
$ARGUMENTS - The feature idea from user
```

**Examples:**
- "Add support for custom report templates"
- "Build customer analytics dashboard"
- "Implement email notification preferences"

## Execution Steps

### Step 1: Validate Input

```typescript
if (!$ARGUMENTS || $ARGUMENTS.trim() === '') {
  throw new Error('Feature idea required. Usage: /loom:ideate <feature idea>');
}
```

### Step 2: Spawn Architect Agent

Delegate the ideation work to the architect using the Task tool:

```typescript
Task({
  subagent_type: "architect",
  model: "opus",
  description: "Analyze feature idea and create story definition",
  prompt: `
You are the Solutions Architect for the Loom SDLC system.

## Your Task

Transform this feature idea into a structured story definition:

**Feature Idea:** ${$ARGUMENTS}

## What You Need to Do

1. **Analyze the Idea**
   - What is the core value proposition?
   - What problem does this solve?
   - Extract the WHY (root motivation)

2. **Define Acceptance Criteria**
   - Create 3-7 testable acceptance criteria
   - Each AC must be specific and verifiable
   - Format: "User can X", "System does Y when Z"
   - Focus on WHAT needs to work, not HOW to implement

3. **Make Design Decisions (if applicable)**
   - Are there API contracts needed?
   - Are there schema changes needed?
   - What are the key technology decisions?

4. **Determine Feature Code**
   - Based on the idea, suggest a 2-6 letter feature code
   - Examples: AUTH, NOTIFY, DASH, REPORT, ANALYTICS
   - Use existing feature codes if this extends an existing feature

5. **Estimate Complexity**
   - Low: 1-3 tasks, minimal dependencies
   - Medium: 4-8 tasks, moderate complexity
   - High: 9+ tasks, complex dependencies

## Output Format (JSON)

Return ONLY valid JSON in this exact format:

\`\`\`json
{
  "title": "Clear, concise story title",
  "why": "Root motivation - why this matters to users/business",
  "description": "What we're building (2-3 sentences)",
  "featureCode": "SUGGESTED_CODE",
  "acceptanceCriteria": [
    { "id": "AC-001", "description": "Specific, testable criterion" },
    { "id": "AC-002", "description": "Another specific criterion" }
  ],
  "designDecisions": [
    {
      "decision": "Use X technology/approach",
      "rationale": "Because Y reason",
      "alternatives": ["Option A", "Option B"]
    }
  ],
  "estimatedComplexity": "low|medium|high",
  "priority": "P0|P1|P2|P3"
}
\`\`\`

## Important

- DO NOT write implementation code
- DO NOT create files
- Return ONLY the JSON, no other text
`
})
```

### Step 3: Parse Architect Output and Create Story via Board CLI

Parse the JSON response from the architect and use the Board CLI:

```bash
# Parse architect's JSON output
# Extract featureCode, title, why, description, acceptanceCriteria, etc.

# Step 3a: Check if feature exists, create if not
board feature show ${FEATURE_CODE} --json 2>/dev/null || \
  board feature create -c ${FEATURE_CODE} -n "${FEATURE_NAME}" -d "${DESCRIPTION}"

# Step 3b: Create story via board CLI
# Returns JSON with story code (e.g., NOTIFY-003)
board story create \
  -f ${FEATURE_CODE} \
  -t "${TITLE}" \
  -w "${WHY}" \
  -d "${DESCRIPTION}" \
  -s planned \
  -p ${PRIORITY} \
  -c ${COMPLEXITY} \
  --json

# Extract story ID from response
STORY_ID=$(... | jq -r '.code')

# Step 3c: Create acceptance criteria
for ac in acceptanceCriteria:
  board ac add -s ${STORY_ID} -d "${ac.description}" -c ${ac.id}
```

**Using TypeScript client (alternative):**
```typescript
import { createFeature, getFeature, createStory, createAC } from 'src/board/client';

// Check/create feature
const featureResult = await getFeature(featureCode);
if (!featureResult.success) {
  await createFeature({ code: featureCode, name: featureName, description });
}

// Create story
const storyResult = await createStory({
  feature: featureCode,
  title,
  why,
  description,
  status: 'planned',
  priority,
  complexity
});
const storyId = storyResult.data.code;

// Create ACs
for (const ac of acceptanceCriteria) {
  await createAC({ story: storyId, description: ac.description, code: ac.id });
}
```

### Step 4: Report to User

```markdown
✅ Story Created: ${storyId}

**Title:** ${title}
**WHY:** ${why}

**Acceptance Criteria:** ${acCount} defined
- AC-001: Description...
- AC-002: Description...

**Complexity:** ${complexity}
**Priority:** ${priority}

**Design Decisions:** ${decisionCount} made
- Decision 1...
- Decision 2...

**View in TUI:** board-tui
**View story:** board story show ${storyId}

**Next Step:** /loom:plan ${storyId}
```

## Feature Code Patterns

Common feature code conventions:
- Authentication → AUTH
- Notifications → NOTIFY
- Dashboard → DASH
- Reports → REPORT
- Analytics → ANALYTICS
- Accounts → ACCT
- Products → PROD
- Customers → CUST

## Error Handling

### Invalid JSON from Architect

```typescript
try {
  const output = JSON.parse(architectResponse);
} catch (err) {
  throw new Error('Architect returned invalid JSON. Please try again.');
}
```

### Missing Required Fields

```typescript
const required = ['title', 'why', 'description', 'featureCode', 'acceptanceCriteria'];
for (const field of required) {
  if (!output[field]) {
    throw new Error(`Architect output missing required field: ${field}`);
  }
}
```

## Success Criteria

Ideation is complete when:

- ✅ Architect analyzed the feature idea
- ✅ WHY (root motivation) extracted
- ✅ 3-7 testable acceptance criteria defined
- ✅ Story created in Board CLI (SQLite)
- ✅ ACs created in Board CLI
- ✅ Story viewable via `board story show` and `board-tui`

## Next Command

After ideation completes, user should run:

```
/loom:plan ${storyId}
```

This will break the story into atomic tasks with dependencies.
