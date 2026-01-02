# Weave Schema Definitions

This document defines the structure for each dimension of the Weave knowledge system.

## Core Principles

1. **Machine-readable** - All schemas are valid JSON with TypeScript type definitions
2. **Provenance-tracked** - Every piece of knowledge includes its source
3. **Confidence-weighted** - Epistemological uncertainty is explicit
4. **Temporal** - Knowledge evolution is tracked over time

---

## 1. Ontology (What Exists)

Captures entities, their properties, relationships, and constraints.

### Schema

```typescript
interface Ontology {
  version: string;
  lastUpdated: string | null;
  entities: Record<EntityId, Entity>;
  relations: Record<RelationId, Relation>;
  constraints: Record<ConstraintId, Constraint>;
}

interface Entity {
  id: string;
  name: string;
  type: EntityType;
  description?: string;
  properties: Property[];
  location?: CodeLocation;
  provenance: Provenance;
}

type EntityType =
  | 'domain-entity'      // Business domain (Contact, Campaign, Lead)
  | 'module'             // Code module (crm, campaigns, auth)
  | 'service'            // Service class (LeadService, CampaignService)
  | 'api-endpoint'       // HTTP endpoint
  | 'database-table'     // Database table
  | 'architectural-pattern' // Design pattern (CQRS, SSE)
  | 'library'            // External dependency
  | 'type-definition';   // TypeScript type/interface

interface Property {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

interface Relation {
  id: string;
  type: RelationType;
  source: EntityId;
  target: EntityId;
  properties?: Record<string, any>;
  provenance: Provenance;
}

type RelationType =
  | 'has-many'
  | 'belongs-to'
  | 'references'
  | 'implements'
  | 'extends'
  | 'uses'
  | 'depends-on';

interface Constraint {
  id: string;
  type: ConstraintType;
  entities: EntityId[];
  rule: string;
  description?: string;
  provenance: Provenance;
}

type ConstraintType =
  | 'unique'
  | 'required'
  | 'validation'
  | 'business-rule'
  | 'state-transition';

interface CodeLocation {
  file: string;
  startLine?: number;
  endLine?: number;
}
```

### Example

```json
{
  "version": "1.0.0",
  "lastUpdated": "2024-11-20T10:30:00Z",
  "entities": {
    "campaign": {
      "id": "campaign",
      "name": "Campaign",
      "type": "domain-entity",
      "description": "Email campaign entity for bulk messaging",
      "properties": [
        {
          "name": "id",
          "type": "string",
          "required": true,
          "description": "Unique campaign identifier"
        },
        {
          "name": "status",
          "type": "CampaignStatus",
          "required": true,
          "description": "Current lifecycle status"
        }
      ],
      "location": {
        "file": "packages/db/src/schema/campaigns.ts",
        "startLine": 12,
        "endLine": 45
      },
      "provenance": {
        "source": "code-analysis",
        "sessionId": "session-abc123",
        "timestamp": "2024-11-20T10:30:00Z"
      }
    }
  },
  "relations": {
    "campaign-has-messages": {
      "id": "campaign-has-messages",
      "type": "has-many",
      "source": "campaign",
      "target": "message",
      "properties": {
        "cascade": "delete"
      },
      "provenance": {
        "source": "schema-analysis",
        "sessionId": "session-abc123",
        "timestamp": "2024-11-20T10:30:00Z"
      }
    }
  },
  "constraints": {
    "campaign-status-transition": {
      "id": "campaign-status-transition",
      "type": "state-transition",
      "entities": ["campaign"],
      "rule": "draft → scheduled → sent → completed",
      "description": "Valid campaign status transitions",
      "provenance": {
        "source": "business-logic-analysis",
        "sessionId": "session-def456",
        "timestamp": "2024-11-20T11:00:00Z"
      }
    }
  }
}
```

---

## 2. Mereology (How Things Compose)

Captures part-whole relationships, component hierarchy, and system composition.

### Schema

```typescript
interface Mereology {
  version: string;
  lastUpdated: string | null;
  components: Record<ComponentId, Component>;
  compositions: Record<CompositionId, Composition>;
  hierarchy: SystemHierarchy;
}

interface Component {
  id: string;
  name: string;
  type: ComponentType;
  description?: string;
  location?: CodeLocation;
  dependencies: string[]; // Component IDs
  provenance: Provenance;
}

type ComponentType =
  | 'module'
  | 'service'
  | 'controller'
  | 'repository'
  | 'middleware'
  | 'utility'
  | 'hook'
  | 'component'
  | 'route';

interface Composition {
  id: string;
  whole: ComponentId;
  parts: ComponentId[];
  compositionType: CompositionType;
  emergentProperties?: string[]; // What emerges from composition
  provenance: Provenance;
}

type CompositionType =
  | 'aggregation'    // Parts can exist independently
  | 'composition'    // Parts cannot exist without whole
  | 'collection';    // Loose grouping

interface SystemHierarchy {
  root: string; // Top-level component
  layers: Layer[];
  modules: Module[];
}

interface Layer {
  name: string;
  level: number; // 0=infrastructure, 1=domain, 2=application, 3=presentation
  components: ComponentId[];
}

interface Module {
  id: string;
  name: string;
  path: string;
  components: ComponentId[];
  submodules: string[]; // Module IDs
}
```

### Example

```json
{
  "version": "1.0.0",
  "lastUpdated": "2024-11-20T10:30:00Z",
  "components": {
    "campaign-service": {
      "id": "campaign-service",
      "name": "CampaignService",
      "type": "service",
      "description": "Handles campaign business logic",
      "location": {
        "file": "apps/api/src/modules/crm/services/campaign.ts"
      },
      "dependencies": [
        "campaign-repository",
        "message-service",
        "queue-service"
      ],
      "provenance": {
        "source": "dependency-analysis",
        "sessionId": "session-abc123",
        "timestamp": "2024-11-20T10:30:00Z"
      }
    }
  },
  "compositions": {
    "campaign-module": {
      "id": "campaign-module",
      "whole": "campaign-module",
      "parts": [
        "campaign-service",
        "campaign-repository",
        "campaign-routes",
        "campaign-validation"
      ],
      "compositionType": "composition",
      "emergentProperties": [
        "bulk-email-capability",
        "scheduled-sending",
        "delivery-tracking"
      ],
      "provenance": {
        "source": "module-analysis",
        "sessionId": "session-abc123",
        "timestamp": "2024-11-20T10:30:00Z"
      }
    }
  },
  "hierarchy": {
    "root": "agios-platform",
    "layers": [
      {
        "name": "infrastructure",
        "level": 0,
        "components": ["database", "queue", "cache"]
      },
      {
        "name": "domain",
        "level": 1,
        "components": ["campaign-service", "lead-service"]
      }
    ],
    "modules": [
      {
        "id": "crm-module",
        "name": "CRM",
        "path": "apps/api/src/modules/crm",
        "components": ["campaign-service", "lead-service", "contact-service"],
        "submodules": ["campaigns", "leads", "contacts"]
      }
    ]
  }
}
```

---

## 3. Epistemology (How We Know)

Captures confidence levels, evidence, observations, and knowledge provenance.

### Schema

```typescript
interface Epistemology {
  version: string;
  lastUpdated: string | null;
  knowledge: Record<KnowledgeId, KnowledgeItem>;
  patterns: Record<PatternId, Pattern>;
  validations: Record<ValidationId, Validation>;
}

interface KnowledgeItem {
  id: string;
  concept: string; // References ontology entity or mereology component
  confidence: number; // 0.0 to 1.0
  basis: KnowledgeBasis;
  observations: number;
  firstSeen: string; // ISO timestamp
  lastSeen: string; // ISO timestamp
  sources: string[]; // Session IDs
  contradictions: Contradiction[];
  validations: string[]; // Validation IDs
}

type KnowledgeBasis =
  | 'empirical'      // Observed in code/behavior
  | 'inferred'       // Derived from patterns
  | 'documented'     // From comments/docs
  | 'validated'      // Tested/confirmed
  | 'assumed';       // Unverified belief

interface Pattern {
  id: string;
  name: string;
  description: string;
  type: PatternType;
  confidence: number;
  observations: number;
  examples: Example[];
  provenance: Provenance;
}

type PatternType =
  | 'architectural'
  | 'code-pattern'
  | 'workflow'
  | 'error-pattern'
  | 'usage-pattern';

interface Example {
  sessionId: string;
  location?: CodeLocation;
  context?: string;
}

interface Validation {
  id: string;
  concept: string;
  validationType: ValidationType;
  successful: boolean;
  timestamp: string;
  evidence: Evidence;
}

type ValidationType =
  | 'test-passed'
  | 'commit-successful'
  | 'pattern-repeated'
  | 'manual-verification';

interface Evidence {
  type: string;
  data: any;
  source: string;
}

interface Contradiction {
  observedAt: string;
  description: string;
  sessionId: string;
  resolved: boolean;
}
```

### Example

```json
{
  "version": "1.0.0",
  "lastUpdated": "2024-11-20T10:30:00Z",
  "knowledge": {
    "sse-pattern-knowledge": {
      "id": "sse-pattern-knowledge",
      "concept": "sse-realtime-pattern",
      "confidence": 0.95,
      "basis": "validated",
      "observations": 12,
      "firstSeen": "2024-03-15T10:00:00Z",
      "lastSeen": "2024-11-20T10:30:00Z",
      "sources": [
        "session-abc123",
        "session-def456",
        "session-ghi789"
      ],
      "contradictions": [],
      "validations": ["validation-001", "validation-002"]
    }
  },
  "patterns": {
    "sse-realtime-pattern": {
      "id": "sse-realtime-pattern",
      "name": "SSE Real-time Updates",
      "description": "Server-Sent Events pattern for real-time data streaming",
      "type": "architectural",
      "confidence": 0.95,
      "observations": 12,
      "examples": [
        {
          "sessionId": "session-abc123",
          "location": {
            "file": "apps/api/src/modules/crm/routes/contacts-sse.ts"
          },
          "context": "Real-time contact updates"
        }
      ],
      "provenance": {
        "source": "pattern-detection",
        "sessionId": "session-abc123",
        "timestamp": "2024-03-15T10:00:00Z"
      }
    }
  },
  "validations": {
    "validation-001": {
      "id": "validation-001",
      "concept": "sse-realtime-pattern",
      "validationType": "test-passed",
      "successful": true,
      "timestamp": "2024-11-20T10:30:00Z",
      "evidence": {
        "type": "test-results",
        "data": {
          "testFile": "apps/api/src/modules/crm/routes/contacts-sse.test.ts",
          "passed": 15,
          "failed": 0
        },
        "source": "session-abc123"
      }
    }
  }
}
```

---

## 4. Qualia (What It's Like)

Captures experiential knowledge, pain points, best practices, and tacit understanding.

### Schema

```typescript
interface Qualia {
  version: string;
  lastUpdated: string | null;
  painPoints: Record<PainPointId, PainPoint>;
  solutions: Record<SolutionId, Solution>;
  workflows: Record<WorkflowId, Workflow>;
  bestPractices: Record<PracticeId, BestPractice>;
  contextualKnowledge: Record<ContextId, ContextualKnowledge>;
}

interface PainPoint {
  id: string;
  concept?: string; // Related entity/component
  description: string;
  severity: Severity;
  frequency: number; // How often encountered
  firstSeen: string;
  lastSeen: string;
  relatedErrors: ErrorReference[];
  solutions: string[]; // Solution IDs
  provenance: Provenance;
}

type Severity = 'low' | 'medium' | 'high' | 'critical';

interface ErrorReference {
  message: string;
  stackTrace?: string;
  sessionId: string;
}

interface Solution {
  id: string;
  problem: string; // PainPoint ID
  approach: string;
  effectiveness: number; // 0.0 to 1.0
  context: Context;
  examples: Example[];
  provenance: Provenance;
}

interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  successRate: number;
  context: Context;
  observations: number;
  provenance: Provenance;
}

interface WorkflowStep {
  order: number;
  action: string;
  toolsUsed?: string[];
  commonIssues?: string[];
}

interface BestPractice {
  id: string;
  concept: string;
  practice: string;
  rationale: string;
  examples: Example[];
  confidence: number;
  provenance: Provenance;
}

interface ContextualKnowledge {
  id: string;
  concept: string;
  context: {
    why?: string;      // Rationale/intent
    when?: string;     // Use cases
    how?: string;      // Implementation approach
    gotchas?: string[]; // Known issues/warnings
  };
  provenance: Provenance;
}

interface Context {
  taskType?: string;
  fileTypes?: string[];
  modules?: string[];
  relatedConcepts?: string[];
}
```

### Example

```json
{
  "version": "1.0.0",
  "lastUpdated": "2024-11-20T10:30:00Z",
  "painPoints": {
    "sse-memory-leak": {
      "id": "sse-memory-leak",
      "concept": "sse-realtime-pattern",
      "description": "EventSource connection not closed on component unmount causes memory leak",
      "severity": "high",
      "frequency": 3,
      "firstSeen": "2024-06-10T14:00:00Z",
      "lastSeen": "2024-11-15T09:30:00Z",
      "relatedErrors": [
        {
          "message": "Memory usage growing continuously in browser",
          "sessionId": "session-xyz789"
        }
      ],
      "solutions": ["solution-sse-cleanup"],
      "provenance": {
        "source": "error-tracking",
        "sessionId": "session-xyz789",
        "timestamp": "2024-06-10T14:00:00Z"
      }
    }
  },
  "solutions": {
    "solution-sse-cleanup": {
      "id": "solution-sse-cleanup",
      "problem": "sse-memory-leak",
      "approach": "Add cleanup in useEffect return function to close EventSource",
      "effectiveness": 1.0,
      "context": {
        "taskType": "frontend-development",
        "fileTypes": [".tsx", ".ts"],
        "modules": ["react-hooks"]
      },
      "examples": [
        {
          "sessionId": "session-xyz789",
          "location": {
            "file": "apps/web/app/hooks/useSSE.ts",
            "startLine": 25,
            "endLine": 30
          }
        }
      ],
      "provenance": {
        "source": "fix-implementation",
        "sessionId": "session-xyz789",
        "timestamp": "2024-06-10T15:00:00Z"
      }
    }
  },
  "workflows": {
    "add-sse-endpoint": {
      "id": "add-sse-endpoint",
      "name": "Adding SSE Endpoint",
      "description": "Standard workflow for implementing new SSE real-time endpoint",
      "steps": [
        {
          "order": 1,
          "action": "Create backend SSE route with PostgreSQL NOTIFY trigger",
          "toolsUsed": ["Write", "Edit"],
          "commonIssues": ["Forgot CORS headers"]
        },
        {
          "order": 2,
          "action": "Add React Query SSE hook on frontend",
          "toolsUsed": ["Write"],
          "commonIssues": ["EventSource not closed on unmount"]
        },
        {
          "order": 3,
          "action": "Test with multiple tabs for connection pooling",
          "toolsUsed": ["Bash", "Chrome"],
          "commonIssues": ["BroadcastChannel not working"]
        }
      ],
      "successRate": 0.9,
      "context": {
        "taskType": "feature-development",
        "modules": ["api", "web"]
      },
      "observations": 8,
      "provenance": {
        "source": "workflow-detection",
        "sessionId": "session-abc123",
        "timestamp": "2024-11-20T10:30:00Z"
      }
    }
  },
  "bestPractices": {
    "sse-cleanup-practice": {
      "id": "sse-cleanup-practice",
      "concept": "sse-realtime-pattern",
      "practice": "Always close EventSource in cleanup function",
      "rationale": "Prevents memory leaks and connection exhaustion",
      "examples": [
        {
          "sessionId": "session-xyz789",
          "location": {
            "file": "apps/web/app/hooks/useSSE.ts"
          }
        }
      ],
      "confidence": 0.95,
      "provenance": {
        "source": "practice-extraction",
        "sessionId": "session-xyz789",
        "timestamp": "2024-06-10T15:00:00Z"
      }
    }
  },
  "contextualKnowledge": {
    "campaign-intent": {
      "id": "campaign-intent",
      "concept": "campaign",
      "context": {
        "why": "Enable bulk email communication with customers at scale",
        "when": "Use for newsletters, announcements, promotional content",
        "how": "Create campaign → add recipients → select template → schedule → monitor",
        "gotchas": [
          "Check deliverability settings before sending",
          "Large recipient lists need queue processing",
          "Status transitions are one-way (can't unsend)"
        ]
      },
      "provenance": {
        "source": "commit-message-analysis",
        "sessionId": "session-abc123",
        "timestamp": "2024-11-20T10:30:00Z"
      }
    }
  }
}
```

---

## 5. Common Types

Shared type definitions used across all dimensions.

```typescript
interface Provenance {
  source: ProvenanceSource;
  sessionId: string;
  timestamp: string;
  agent?: string; // Agent type if applicable
  confidence?: number;
}

type ProvenanceSource =
  | 'code-analysis'
  | 'schema-analysis'
  | 'dependency-analysis'
  | 'pattern-detection'
  | 'error-tracking'
  | 'fix-implementation'
  | 'workflow-detection'
  | 'commit-message-analysis'
  | 'manual-annotation';

interface CodeLocation {
  file: string;
  startLine?: number;
  endLine?: number;
}

interface Example {
  sessionId: string;
  location?: CodeLocation;
  context?: string;
}
```

---

## 6. Meta Schema

Tracks overall Weave health and statistics.

```typescript
interface Meta {
  version: string;
  createdAt: string;
  lastUpdated: string;
  stats: {
    totalEntities: number;
    totalRelations: number;
    totalComponents: number;
    totalPatterns: number;
    totalPainPoints: number;
    averageConfidence: number;
    totalSessions: number;
  };
  health: {
    ontologyCoverage: number; // 0.0 to 1.0
    epistemicConfidence: number; // Average confidence
    qualiaDepth: number; // Amount of experiential knowledge
    lastCompaction?: string;
  };
}
```

### Example

```json
{
  "version": "1.0.0",
  "createdAt": "2024-11-20T10:00:00Z",
  "lastUpdated": "2024-11-20T10:30:00Z",
  "stats": {
    "totalEntities": 45,
    "totalRelations": 78,
    "totalComponents": 32,
    "totalPatterns": 12,
    "totalPainPoints": 8,
    "averageConfidence": 0.87,
    "totalSessions": 23
  },
  "health": {
    "ontologyCoverage": 0.75,
    "epistemicConfidence": 0.87,
    "qualiaDepth": 0.65,
    "lastCompaction": null
  }
}
```

---

## Design Principles

1. **Explicit is better than implicit** - All metadata, provenance, and confidence is explicit
2. **Everything has a source** - Provenance tracking for all knowledge
3. **Uncertainty is tracked** - Confidence levels, contradictions, validations
4. **Time-aware** - First seen, last seen, timestamps throughout
5. **Cross-references** - IDs link concepts across dimensions
6. **Extensible** - Additional properties can be added without breaking
7. **Machine and human readable** - JSON for machines, clear naming for humans

---

## Next Steps

1. Implement extraction functions for each dimension
2. Design merge strategies for updating existing knowledge
3. Build query interface for retrieval
4. Integrate with session-end hook
