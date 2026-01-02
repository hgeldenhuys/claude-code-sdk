# Agent Lifecycle Patterns

Detailed implementations of common agent lifecycle patterns.

## Table of Contents

1. [Session-Scoped Advisor](#pattern-1-session-scoped-advisor)
2. [Workflow-Scoped Execution](#pattern-2-workflow-scoped-execution)
3. [Turn-Scoped Helper](#pattern-3-turn-scoped-helper)
4. [Project Singleton](#pattern-4-project-singleton)
5. [Multi-Agent Orchestration](#pattern-5-multi-agent-orchestration)

---

## Pattern 1: Session-Scoped Advisor

Agents that persist throughout a Claude Code session, ideal for knowledge retrieval and advisory roles.

### Use Cases

- Knowledge advisors (Shadow Advisor, Librarian)
- Context-aware assistants
- Session-wide configuration managers

### Implementation

```typescript
import { AgentRegistry } from 'claude-agent-lifecycle';

export async function getSessionAdvisor(role: string) {
  const registry = new AgentRegistry();

  const { agent, isNew } = await registry.create({
    lifespan: 'session',
    name: `${role}-advisor`,
    model: 'haiku',
    metadata: {
      role,
      capabilities: ['knowledge-retrieval', 'pattern-matching'],
      preloadedAt: new Date().toISOString(),
    },
  });

  if (isNew) {
    // First creation - load initial context
    console.log(`Created new ${role} advisor`);
    // Initialize with domain knowledge...
  } else {
    // Resumed - increment interaction count
    console.log(`Resumed ${role} advisor (turn ${agent.turnCount})`);
  }

  return agent;
}

// Usage
const shadow = await getSessionAdvisor('shadow');
const librarian = await getSessionAdvisor('librarian');
```

### Hook Integration

Automatically disposed at SessionEnd:

```typescript
// hooks/session-cleanup.ts
import { AgentRegistry } from 'claude-agent-lifecycle';
import { getHookEvent } from 'claude-hooks-sdk';

const event = getHookEvent();

if (event.type === 'SessionEnd') {
  const registry = new AgentRegistry();
  const count = await registry.disposeByScope(event.session.sessionId);
  console.log(`Disposed ${count} session agents`);
}
```

---

## Pattern 2: Workflow-Scoped Execution

Agents tied to a bounded unit of work (story, feature, task). Multiple specialists collaborate on a shared workflow.

### Use Cases

- Story execution (Loom)
- Feature development
- Multi-step task orchestration

### Implementation

```typescript
import { AgentRegistry } from 'claude-agent-lifecycle';

export class WorkflowOrchestrator {
  private registry: AgentRegistry;
  private workflowId: string;

  constructor(workflowId: string) {
    this.registry = new AgentRegistry();
    this.workflowId = workflowId;
  }

  async start() {
    // Create main executor
    return await this.registry.startWorkflow({
      lifespan: 'workflow',
      workflowId: this.workflowId,
      name: 'executor',
      workflowType: 'story-execution',
      model: 'sonnet',
      metadata: {
        startedAt: new Date().toISOString(),
        status: 'in-progress',
      },
    });
  }

  async addSpecialist(role: string) {
    const validRoles = [
      'backend-dev',
      'frontend-dev',
      'backend-qa',
      'frontend-qa',
      'cli-dev',
    ];

    if (!validRoles.includes(role)) {
      throw new Error(`Invalid role: ${role}`);
    }

    return await this.registry.startWorkflow({
      lifespan: 'workflow',
      workflowId: this.workflowId,
      name: role,
      model: role.includes('qa') ? 'haiku' : 'sonnet',
      metadata: { role, assignedAt: new Date().toISOString() },
    });
  }

  async getStatus() {
    const agents = await this.registry.getWorkflowAgents(this.workflowId);
    return {
      workflowId: this.workflowId,
      agentCount: agents.length,
      agents: agents.map(a => ({
        name: a.name,
        turnCount: a.turnCount,
        lastActive: a.lastActiveAt,
      })),
    };
  }

  async complete() {
    const count = await this.registry.completeWorkflow(this.workflowId);
    console.log(`Completed workflow ${this.workflowId}, disposed ${count} agents`);
    return count;
  }
}

// Usage
const orchestrator = new WorkflowOrchestrator('FEAT-001');
await orchestrator.start();
await orchestrator.addSpecialist('backend-dev');
await orchestrator.addSpecialist('backend-qa');

// ... execute work ...

await orchestrator.complete();
```

---

## Pattern 3: Turn-Scoped Helper

Short-lived agents that assist with a single response cycle. Automatically disposed when Stop hook fires.

### Use Cases

- Code analysis helpers
- One-off data processors
- Temporary computation agents

### Implementation

```typescript
import { AgentRegistry } from 'claude-agent-lifecycle';

export async function createTurnHelper(task: string) {
  const registry = new AgentRegistry();

  const { agent } = await registry.create({
    lifespan: 'turn',
    name: `helper-${task}`,
    model: 'haiku',
    metadata: {
      task,
      createdFor: 'single-response',
    },
  });

  return agent;
}

// Usage - agent disposed automatically at Stop
const analyzer = await createTurnHelper('code-analysis');
const formatter = await createTurnHelper('output-formatting');
```

### Hook Integration

```typescript
// hooks/turn-cleanup.ts
import { AgentRegistry } from 'claude-agent-lifecycle';
import { getHookEvent } from 'claude-hooks-sdk';

const event = getHookEvent();

if (event.type === 'Stop') {
  const registry = new AgentRegistry();
  const count = await registry.disposeByLifespan('turn');
  if (count > 0) {
    console.log(`Disposed ${count} turn-scoped agents`);
  }
}
```

---

## Pattern 4: Project Singleton

Agents that persist indefinitely, shared across all sessions. Requires manual disposal.

### Use Cases

- Project configuration managers
- Shared knowledge bases
- Cross-session state holders

### Implementation

```typescript
import { AgentRegistry } from 'claude-agent-lifecycle';

export async function getProjectSingleton(name: string) {
  const registry = new AgentRegistry();

  const { agent, isNew } = await registry.create({
    lifespan: 'project',
    name,
    metadata: {
      singleton: true,
      initVersion: '1.0.0',
    },
  });

  if (isNew) {
    console.log(`Created project singleton: ${name}`);
  } else {
    console.log(`Using existing singleton: ${name} (${agent.turnCount} turns)`);
  }

  return agent;
}

// Manual disposal when needed
export async function disposeProjectSingleton(name: string) {
  const registry = new AgentRegistry();
  const agent = await registry.resume(name);
  if (agent) {
    await registry.dispose(agent.agentId);
    console.log(`Disposed project singleton: ${name}`);
  }
}
```

---

## Pattern 5: Multi-Agent Orchestration

Coordinating multiple agents across different lifespans.

### Implementation

```typescript
import { AgentRegistry } from 'claude-agent-lifecycle';

export class MultiAgentSystem {
  private registry: AgentRegistry;

  constructor() {
    this.registry = new AgentRegistry({ debug: true });
  }

  async initialize(sessionId: string, workflowId: string) {
    // Session-scoped: knowledge advisors
    await this.registry.create({
      lifespan: 'session',
      name: 'shadow-advisor',
      sessionId,
      model: 'haiku',
    });

    await this.registry.create({
      lifespan: 'session',
      name: 'librarian',
      sessionId,
      model: 'haiku',
    });

    // Workflow-scoped: execution agents
    await this.registry.startWorkflow({
      lifespan: 'workflow',
      workflowId,
      name: 'executor',
      model: 'sonnet',
    });

    // Turn-scoped: temporary helpers created as needed
    // (created per-request, not at initialization)
  }

  async getSystemStatus() {
    const agents = await this.registry.list();

    return {
      total: agents.length,
      byLifespan: {
        session: agents.filter(a => a.lifespan === 'session').length,
        workflow: agents.filter(a => a.lifespan === 'workflow').length,
        turn: agents.filter(a => a.lifespan === 'turn').length,
        project: agents.filter(a => a.lifespan === 'project').length,
      },
      agents: agents.map(a => ({
        name: a.name,
        lifespan: a.lifespan,
        scope: a.scope,
        turns: a.turnCount,
      })),
    };
  }
}
```

---

## Best Practices Summary

| Pattern | Lifespan | Model | Disposal |
|---------|----------|-------|----------|
| Knowledge Advisor | session | haiku | SessionEnd hook |
| Workflow Executor | workflow | sonnet | completeWorkflow() |
| Workflow Specialist | workflow | sonnet/haiku | completeWorkflow() |
| Turn Helper | turn | haiku | Stop hook |
| Project Singleton | project | varies | Manual |
