# API Reference

Complete API documentation for claude-agent-lifecycle.

## Table of Contents

1. [AgentRegistry](#agentregistry)
2. [Methods](#methods)
3. [Types](#types)
4. [Storage Backends](#storage-backends)

---

## AgentRegistry

Main class for managing agent lifecycles.

```typescript
import { AgentRegistry } from 'claude-agent-lifecycle';

const registry = new AgentRegistry(options?: RegistryOptions);
```

### RegistryOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `storagePath` | `string` | `.agent/agents` | Base path for file storage |
| `debug` | `boolean` | `false` | Enable debug logging |

---

## Methods

### create(config)

Creates a new agent or resumes an existing one.

```typescript
const { agent, isNew } = await registry.create({
  lifespan: 'session',
  name: 'my-agent',
  sessionId?: string,    // Auto-detected if not provided
  model?: string,        // 'haiku', 'sonnet', 'opus'
  metadata?: Record<string, unknown>,
});
```

**Returns**: `{ agent: Agent, isNew: boolean }`

**Behavior**:
- If agent with same name exists in scope, resumes it
- If not, creates new agent
- `isNew` indicates whether agent was created or resumed

### resume(name, scope?)

Resumes an existing agent by name.

```typescript
const agent = await registry.resume('my-agent');
const agent = await registry.resume('my-agent', 'session-123');
```

**Returns**: `Agent | null`

**Throws**: If agent not found and no scope provided

### dispose(agentId)

Disposes a specific agent by ID.

```typescript
await registry.dispose('agent-uuid-here');
```

**Returns**: `void`

### disposeByLifespan(lifespan)

Disposes all agents of a specific lifespan type.

```typescript
const count = await registry.disposeByLifespan('turn');
```

**Returns**: `number` - Count of disposed agents

### disposeByScope(scope)

Disposes all agents in a specific scope.

```typescript
const count = await registry.disposeByScope('session-123');
```

**Returns**: `number` - Count of disposed agents

### list(filter?)

Lists agents matching optional filter criteria.

```typescript
// List all agents
const all = await registry.list();

// Filter by lifespan
const sessionAgents = await registry.list({ lifespan: 'session' });

// Filter by scope
const workflowAgents = await registry.list({ scope: 'FEAT-001' });
```

**Returns**: `Agent[]`

### startWorkflow(config)

Starts a workflow-scoped agent.

```typescript
const agent = await registry.startWorkflow({
  lifespan: 'workflow',
  workflowId: 'FEAT-001',
  name: 'executor',
  workflowType?: string,  // e.g., 'loom-story'
  model?: string,
  metadata?: Record<string, unknown>,
});
```

**Returns**: `Agent`

### completeWorkflow(workflowId)

Completes a workflow and disposes all its agents.

```typescript
const disposed = await registry.completeWorkflow('FEAT-001');
```

**Returns**: `number` - Count of disposed agents

### getWorkflowAgents(workflowId)

Gets all agents for a specific workflow.

```typescript
const agents = await registry.getWorkflowAgents('FEAT-001');
```

**Returns**: `Agent[]`

---

## Types

### Agent

```typescript
interface Agent {
  agentId: string;           // Unique identifier (UUID)
  name: string;              // Human-readable name
  lifespan: Lifespan;        // One of 6 lifespans
  scope: string;             // Scope identifier
  model?: string;            // Model preference
  turnCount: number;         // Interaction count
  metadata?: Record<string, unknown>;
  createdAt: string;         // ISO timestamp
  lastActiveAt: string;      // ISO timestamp
}
```

### Lifespan

```typescript
type Lifespan =
  | 'ephemeral'  // Single use
  | 'turn'       // Until Stop event
  | 'context'    // Until context reset
  | 'session'    // Until SessionEnd event
  | 'workflow'   // Until workflow completes
  | 'project';   // Until manually disposed
```

### CreateConfig

```typescript
interface CreateConfig {
  lifespan: Lifespan;
  name: string;
  sessionId?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}
```

### WorkflowConfig

```typescript
interface WorkflowConfig {
  lifespan: 'workflow';
  workflowId: string;
  name: string;
  workflowType?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}
```

### ListFilter

```typescript
interface ListFilter {
  lifespan?: Lifespan;
  scope?: string;
  name?: string;
}
```

---

## Storage Backends

### MemoryStorage

Used for ephemeral, turn, and context lifespans.

- Data stored in memory
- Lost on process restart
- Fast access, no I/O

### FileStorage

Used for session, workflow, and project lifespans.

- Data persisted to JSON files
- Survives process restarts
- Structure:

```
.agent/agents/
├── lifecycle.log           # Debug logs (when enabled)
├── session/
│   └── {session-id}/
│       └── {agent-name}.json
├── workflow/
│   └── {workflow-id}/
│       └── {agent-name}.json
└── project/
    └── {agent-name}.json
```

### Agent JSON Format

```json
{
  "agentId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "shadow-advisor",
  "lifespan": "session",
  "scope": "abc-123",
  "model": "haiku",
  "turnCount": 5,
  "metadata": {
    "role": "knowledge-retrieval",
    "preloadedKnowledge": ["patterns", "pain-points"]
  },
  "createdAt": "2025-01-15T10:30:00Z",
  "lastActiveAt": "2025-01-15T11:45:00Z"
}
```
