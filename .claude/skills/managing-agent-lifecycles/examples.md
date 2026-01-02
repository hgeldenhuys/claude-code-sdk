# Real-World Examples

Practical examples of agent lifecycle management in production systems.

## Table of Contents

1. [Shadow Advisor (claude-weave)](#example-1-shadow-advisor)
2. [Story Execution (claude-loom)](#example-2-story-execution)
3. [Custom Hook Handler](#example-3-custom-hook-handler)
4. [Debug Logging Setup](#example-4-debug-logging-setup)

---

## Example 1: Shadow Advisor

From claude-weave: A session-scoped knowledge retrieval agent.

### agents/shadow-advisor-lifecycle.ts

```typescript
import { AgentRegistry } from 'claude-agent-lifecycle';
import { getSessionId } from 'claude-hooks-sdk';

const SHADOW_ADVISOR_CONFIG = {
  lifespan: 'session' as const,
  name: 'shadow-advisor',
  model: 'haiku',
  metadata: {
    role: 'knowledge-retrieval',
    preloadedKnowledge: [
      'qualia',      // Pain points, solutions
      'epistemology', // Patterns, validations
      'praxeology',  // WoW patterns
    ],
    capabilities: [
      'query-11d-knowledge',
      'synthesize-across-dimensions',
      'recommend-patterns',
    ],
  },
};

export async function getShadowAdvisor() {
  const registry = new AgentRegistry();
  const sessionId = getSessionId();

  const { agent, isNew } = await registry.create({
    ...SHADOW_ADVISOR_CONFIG,
    sessionId,
  });

  return { agent, isNew };
}

export async function resumeShadowAdvisor() {
  const registry = new AgentRegistry();
  return await registry.resume('shadow-advisor');
}

export async function disposeShadowAdvisor() {
  const registry = new AgentRegistry();
  const agent = await registry.resume('shadow-advisor');
  if (agent) {
    await registry.dispose(agent.agentId);
    return true;
  }
  return false;
}
```

### Usage in Weave Hooks

```typescript
// hooks/weave-hooks.ts
import { getHookEvent } from 'claude-hooks-sdk';
import { getShadowAdvisor } from '../agents/shadow-advisor-lifecycle';

async function handleSessionStart() {
  const { agent, isNew } = await getShadowAdvisor();

  if (isNew) {
    console.log('Shadow Advisor created for session');
    // Load 11D knowledge into agent context...
  } else {
    console.log(`Shadow Advisor resumed (turn ${agent.turnCount})`);
  }
}
```

---

## Example 2: Story Execution

From claude-loom: Workflow-scoped agents for story execution.

### agents/story-lifecycle.ts

```typescript
import { AgentRegistry } from 'claude-agent-lifecycle';

interface StoryConfig {
  storyId: string;
  title: string;
  acceptanceCriteria: string[];
}

export class StoryLifecycle {
  private registry: AgentRegistry;
  private storyId: string;

  constructor(storyId: string) {
    this.registry = new AgentRegistry();
    this.storyId = storyId;
  }

  async start(config: StoryConfig) {
    // Create main executor
    const executor = await this.registry.startWorkflow({
      lifespan: 'workflow',
      workflowId: this.storyId,
      name: 'story-executor',
      workflowType: 'loom-story',
      model: 'sonnet',
      metadata: {
        title: config.title,
        acceptanceCriteria: config.acceptanceCriteria,
        status: 'in-progress',
        startedAt: new Date().toISOString(),
      },
    });

    return executor;
  }

  async addSpecialist(
    role: 'backend-dev' | 'frontend-dev' | 'backend-qa' | 'frontend-qa'
  ) {
    const modelMap = {
      'backend-dev': 'sonnet',
      'frontend-dev': 'sonnet',
      'backend-qa': 'haiku',
      'frontend-qa': 'haiku',
    };

    return await this.registry.startWorkflow({
      lifespan: 'workflow',
      workflowId: this.storyId,
      name: role,
      model: modelMap[role],
      metadata: {
        role,
        assignedAt: new Date().toISOString(),
      },
    });
  }

  async getActiveAgents() {
    return await this.registry.getWorkflowAgents(this.storyId);
  }

  async complete(outcome: 'success' | 'failed' | 'cancelled') {
    const agents = await this.getActiveAgents();

    // Log completion stats
    console.log(`Story ${this.storyId} ${outcome}`);
    console.log(`Agents used: ${agents.length}`);
    for (const agent of agents) {
      console.log(`  - ${agent.name}: ${agent.turnCount} turns`);
    }

    // Dispose all workflow agents
    return await this.registry.completeWorkflow(this.storyId);
  }
}

// Usage
async function executeStory() {
  const story = new StoryLifecycle('FEAT-001');

  await story.start({
    storyId: 'FEAT-001',
    title: 'Add user authentication',
    acceptanceCriteria: [
      'Users can sign up with email',
      'Users can log in',
      'Sessions persist across page reloads',
    ],
  });

  await story.addSpecialist('backend-dev');
  await story.addSpecialist('backend-qa');

  // ... execute story tasks ...

  await story.complete('success');
}
```

---

## Example 3: Custom Hook Handler

Complete hook handler managing multiple agent types.

### hooks/lifecycle-manager.ts

```typescript
#!/usr/bin/env bun
import { AgentRegistry } from 'claude-agent-lifecycle';
import { getHookEvent, getSessionId } from 'claude-hooks-sdk';

const DEBUG = process.env.AGENT_LIFECYCLE_DEBUG === 'true'
  || process.argv.includes('--debug');

function log(message: string) {
  if (DEBUG) {
    console.log(`[agent-lifecycle] ${message}`);
  }
}

async function main() {
  const event = getHookEvent();
  const registry = new AgentRegistry({ debug: DEBUG });

  switch (event.type) {
    case 'SessionStart': {
      const sessionId = getSessionId();
      log(`SessionStart: ${sessionId} (source: ${event.source})`);

      // List active agents
      const agents = await registry.list();
      if (agents.length > 0) {
        log(`Active agents: ${agents.map(a => `${a.name}(${a.lifespan})`).join(', ')}`);
      }
      break;
    }

    case 'Stop': {
      // Dispose turn-scoped agents
      const turnCount = await registry.disposeByLifespan('turn');
      if (turnCount > 0) {
        log(`Stop: Disposed ${turnCount} turn-scoped agents`);
      }
      break;
    }

    case 'SessionEnd': {
      const sessionId = event.session?.sessionId;
      if (sessionId) {
        // Dispose session-scoped agents
        const sessionCount = await registry.disposeByScope(sessionId);
        log(`SessionEnd: Disposed ${sessionCount} agents for session ${sessionId}`);
      }
      break;
    }
  }
}

main().catch(error => {
  console.error('[agent-lifecycle] Error:', error.message);
  process.exit(1);
});
```

---

## Example 4: Debug Logging Setup

Setting up comprehensive debug logging.

### Enable Debug Mode

```bash
# Option 1: Environment variable
export AGENT_LIFECYCLE_DEBUG=true
claude

# Option 2: Per-session
AGENT_LIFECYCLE_DEBUG=true claude

# Option 3: In hook command
# hooks/hooks.json
{
  "Stop": [{
    "hooks": [{
      "type": "command",
      "command": "bun hooks/lifecycle-manager.ts --debug"
    }]
  }]
}
```

### Custom Debug Logger

```typescript
import { AgentRegistry } from 'claude-agent-lifecycle';
import * as fs from 'fs';

class DebugRegistry extends AgentRegistry {
  private logPath: string;

  constructor(logPath = '.agent/agents/debug.log') {
    super({ debug: true });
    this.logPath = logPath;
  }

  private writeLog(entry: object) {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...entry,
    });
    fs.appendFileSync(this.logPath, line + '\n');
  }

  async create(config: any) {
    const result = await super.create(config);
    this.writeLog({
      event: result.isNew ? 'agent:created' : 'agent:resumed',
      agentId: result.agent.agentId,
      name: result.agent.name,
      lifespan: result.agent.lifespan,
    });
    return result;
  }

  async dispose(agentId: string) {
    this.writeLog({
      event: 'agent:disposed',
      agentId,
    });
    return super.dispose(agentId);
  }

  async completeWorkflow(workflowId: string) {
    const agents = await this.getWorkflowAgents(workflowId);
    this.writeLog({
      event: 'workflow:completed',
      workflowId,
      agentCount: agents.length,
      agents: agents.map(a => a.name),
    });
    return super.completeWorkflow(workflowId);
  }
}

// Usage
const registry = new DebugRegistry();
```

### Debug Log Output

```jsonl
{"timestamp":"2025-01-15T10:30:00Z","event":"agent:created","agentId":"abc-123","name":"shadow-advisor","lifespan":"session"}
{"timestamp":"2025-01-15T10:30:05Z","event":"agent:created","agentId":"def-456","name":"backend-dev","lifespan":"workflow"}
{"timestamp":"2025-01-15T10:45:00Z","event":"workflow:completed","workflowId":"FEAT-001","agentCount":3,"agents":["executor","backend-dev","backend-qa"]}
{"timestamp":"2025-01-15T11:00:00Z","event":"agent:disposed","agentId":"abc-123"}
```

---

## Integration Checklist

When integrating agent lifecycle into your project:

- [ ] Install: `bun add claude-agent-lifecycle`
- [ ] Create hooks directory with `hooks.json`
- [ ] Implement `lifecycle-manager.ts` hook handler
- [ ] Define agent configurations (lifespan, name, metadata)
- [ ] Add debug logging for development
- [ ] Test all lifecycle events (SessionStart, Stop, SessionEnd)
- [ ] Verify automatic disposal at boundaries
- [ ] Document agent roles and lifespans
