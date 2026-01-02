---
description: Record a fact observation into Weave with Bayesian confidence tracking
---

# Weave: Observe Fact

Record a learned fact into the Weave knowledge base with Bayesian confidence tracking. Facts gain confidence through repeated observations and validations, and lose confidence through contradictions.

## Input Format

The user provides a fact in one of these formats:

1. **Simple observation**: Just the fact
   ```
   /weave:observe MoneyWorks TSV exports have no header row
   ```

2. **With evidence**: Fact + evidence
   ```
   /weave:observe Transaction.OurRef must be unique | Discovered during import testing
   ```

3. **Validate existing**: Reinforce with validation type
   ```
   /weave:observe validate:test-passed tsv-no-headers | Import tests pass without headers
   ```

4. **Contradict**: Record a contradiction
   ```
   /weave:observe contradict:tsv-no-headers | Found that XML exports DO have headers
   ```

## Processing Steps

1. **Parse the input**:
   - Extract fact text, optional evidence (after `|`)
   - Detect if it's a validate: or contradict: operation
   - Generate kebab-case factId from the fact text

2. **Load Weave and call appropriate method**:
   ```typescript
   import { weave } from '.agent/weave/index';

   // For new observation or reinforcement:
   await weave.observeFact(factId, concept, { evidence, sessionId });

   // For validation:
   await weave.validateFact(factId, validationType, evidence);

   // For contradiction:
   await weave.contradictFact(factId, description, false);
   ```

3. **Report the result**:
   ```
   ✅ Fact recorded: {factId}
      Concept: {concept}
      Confidence: {confidence} ({confidenceLevel})
      Observations: {count}
      Status: {new|reinforced|validated|contradicted}
   ```

## Confidence Model

- **New fact**: Starts at 0.6 confidence (speculative)
- **Observation**: +~0.08 per observation (Bayesian update)
- **Validation**: +~0.12-0.15 depending on type
- **Contradiction**: -0.15 per contradiction
- **Time decay**: Facts not seen in 30+ days flagged as stale

## Validation Types

- `test-passed` - Unit/integration test confirms the fact
- `commit-successful` - Code relying on this fact deployed successfully
- `production-success` - Observed working in production
- `manual-verification` - Human verified the fact

## Examples

### Record a new observation
```
User: /weave:observe DetailLine indices start at 0 not 1

Response:
✅ Fact recorded: detailline-indices-start-at-zero
   Concept: DetailLine indices start at 0 not 1
   Confidence: 0.60 (speculative)
   Observations: 1
   Status: new
```

### Reinforce an existing fact
```
User: /weave:observe DetailLine indices start at 0 not 1

Response:
✅ Fact reinforced: detailline-indices-start-at-zero
   Concept: DetailLine indices start at 0 not 1
   Confidence: 0.68 (probable)
   Observations: 2
   Status: reinforced
```

### Validate with test
```
User: /weave:observe validate:test-passed detailline-indices-start-at-zero | Import test confirms 0-based indexing

Response:
✅ Fact validated: detailline-indices-start-at-zero
   Concept: DetailLine indices start at 0 not 1
   Confidence: 0.82 (confident)
   Validations: 1
   Status: validated
```

### Record contradiction
```
User: /weave:observe contradict:detailline-indices-start-at-zero | Found 1-based indexing in Transaction table

Response:
⚠️ Fact contradicted: detailline-indices-start-at-zero
   Concept: DetailLine indices start at 0 not 1
   Confidence: 0.67 → 0.52 (probable)
   Contradictions: 1 (unresolved)
   Status: contradicted - needs investigation
```

## Integration

Facts recorded here appear in:
- Analytics dashboard under "Knowledge Items"
- Knowledge health reports (low confidence, stale, contradicted)
- Shadow Advisor queries for decision support

## Helper: Generate Fact ID

Convert concept to kebab-case:
```
"MoneyWorks TSV has no headers" → "moneyworks-tsv-has-no-headers"
"DetailLine.Gross is calculated" → "detailline-gross-is-calculated"
```
