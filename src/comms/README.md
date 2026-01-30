# COMMS Architecture Reference

Inter-agent communication system that bridges local Claude Code sessions to a SignalDB cloud backend for real-time message routing, presence tracking, and async knowledge sharing.

## Overview

COMMS allows Claude Code sessions on different machines to communicate. Each machine runs an **Agent Daemon** that:

1. Discovers local Claude Code sessions
2. Registers them as agents in SignalDB
3. Subscribes to an SSE stream for real-time messages
4. Routes incoming messages to the correct local session
5. Sends responses back through SignalDB

## Architecture

```
Local Machine                          SignalDB Cloud
┌────────────────┐                     ┌─────────────────┐
│ Claude Session  │◄──message-router──┐ │ Tapestry API    │
│ (project dir)   │                    │ │ (signaldb.co)   │
└────────────────┘                    │ └───────┬─────────┘
                                      │         │
┌────────────────┐    ┌──────────┐    │    ┌────▼──────┐
│ Session         │    │ Agent    │    │    │ SSEClient │
│ Discovery       │───▶│ Daemon   │────┼───▶│           │
│ (global-        │    │          │    │    └───────────┘
│  sessions.json) │    │ register │    │
└────────────────┘    │ heartbeat│    │    Messages collection
                      │ route    │    │    Agents collection
                      └──────────┘    │    Channels collection
```

## Agent Daemon Lifecycle

### Start

1. **Signal handlers** installed for graceful shutdown (SIGINT/SIGTERM)
2. **Session discovery** reads `~/.claude/global-sessions.json` to find active Claude sessions
3. **Agent registration** creates an agent record in SignalDB per session (machine ID, session ID, session name, project path)
4. **Heartbeat loops** started per agent (default 10s interval) to maintain presence
5. **SSE connection** opened to SignalDB message stream, filtered by `machine_id`
6. **Discovery polling** started (5s interval) to detect new/stale sessions
7. **SSE health check** runs every poll cycle to detect silent stream death

### Running

- Heartbeats keep agents alive in SignalDB
- SSE stream delivers messages in real-time
- Discovery polling registers new sessions and deregisters stale ones
- SSE health check force-reconnects if the stream died silently

### Stop

1. Stop discovery polling
2. Disconnect SSE
3. Stop all heartbeat loops
4. Deregister all agents from SignalDB
5. Remove signal handlers

## Message Routing

When a message arrives via SSE:

1. **Delivery mode check**: `push` (default), `pull` (inbox), or `broadcast` (memo)
2. **Target resolution**: Match message target address to a local session by agent ID, session ID, session name, or project path
3. **Message claim**: Atomically claim the message to prevent duplicate delivery
4. **Claude invocation**: Spawn `claude --resume <sessionId> --append-system-prompt <context> -p <content>`
5. **Response posting**: Send Claude's response back to SignalDB as a reply message
6. **Status update**: Mark message as delivered

### System Prompt Injection

When routing messages to Claude sessions, the router injects COMMS context via `--append-system-prompt`:

```
[COMMS: Incoming Message]
This message was delivered via the Tapestry COMMS system.
From: <senderId>
Channel: <channelId>
Message ID: <id>
Type: <messageType>

Your response will be automatically sent back to the sender via COMMS.
Execute the request and provide a clear response.
```

This tells Claude:
- The message came from COMMS (not a human typing)
- Who sent it
- That the response will be auto-routed back

## SSE Client

The SSE client (`sse-client.ts`) manages the real-time connection to SignalDB:

- **Raw fetch with ReadableStream** (no EventSource polyfill needed in Bun)
- **SSE text protocol parsing** handles `data:`, `id:`, `event:` fields
- **snake_case to camelCase** conversion for SignalDB's response format
- **Exponential backoff reconnection** (1s, 2s, 4s, 8s, max 30s)
- **Last-Event-ID tracking** for resumption after reconnect
- **Keepalive ping** every 15s of idle -- if it fails, aborts the stream to trigger reconnect
- **Health status** exposes `getHealthStatus()` with `connected`, `lastConnectedAt`, `lastEventAt`, `reconnectCount`

### Keepalive Behavior

The keepalive timer pings `/v1/agents?limit=1` after 12s of idle. If the ping fails, the stream is aborted regardless of `shouldReconnect` state. This prevents the scenario where the SSE stream dies silently but the heartbeat keeps the agent showing "active" in SignalDB.

## Delivery Modes

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Push** (default) | Real-time messages | Route to Claude session immediately |
| **Pull** | `metadata.deliveryMode: 'pull'` | Write to local inbox file, read on demand |
| **Broadcast** | `metadata.deliveryMode: 'broadcast'` | Skip routing (memos read via REST) |

## Logging

All daemon components use structured logging via `createLogger()`:

```
[HH:MM:SS] [LEVEL] [component] message {"field": "value"}
```

### Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `COMMS_LOG_LEVEL` | `info` | Minimum log level: `debug`, `info`, `warn`, `error` |
| `COMMS_LOG_FILE` | (none) | Path to append logs to (in addition to stdout) |

### Components

| Component | Module | Logs |
|-----------|--------|------|
| `daemon` | agent-daemon.ts | Lifecycle, session discovery, registration, state changes |
| `sse-client` | sse-client.ts | Connection, keepalive, reconnection, stream events |
| `router` | message-router.ts | Target resolution, delivery, Claude process spawning |

### Example Output

```
[14:30:01] [INFO ] [daemon] Discovered active sessions {"count":2}
[14:30:01] [INFO ] [daemon] Registered session {"sessionId":"abc12345","agentId":"def67890","sessionName":"jolly-squid"}
[14:30:02] [INFO ] [sse-client] SSE stream connected {"url":"https://...","resumeId":null}
[14:30:02] [INFO ] [daemon] Daemon running {"machineId":"m4.local","sessions":2}
[14:30:17] [DEBUG] [sse-client] Keepalive ping OK {"idleMs":15002}
[14:31:05] [INFO ] [daemon] Received message {"messageId":"xyz12345","type":"command","senderId":"abc12345"}
[14:31:05] [INFO ] [router] Routing message to session {"messageId":"xyz12345","sessionId":"abc12345"}
[14:31:08] [INFO ] [router] Message delivered successfully {"messageId":"xyz12345","responseLength":142}
```

## Configuration

The daemon uses `.env.tapestry` for configuration:

```bash
TAPESTRY_ENV=live                          # Active environment (dev/test/live)
TAPESTRY_MACHINE_ID=m4.local               # Machine identifier
TAPESTRY_LIVE_API_URL=https://signaldb.co  # SignalDB API URL
TAPESTRY_LIVE_PROJECT_KEY=sk_live_...      # SignalDB project API key
```

Load with `loadTapestryConfig()` from `src/comms/config/environments.ts`.

### DaemonConfig

```typescript
interface DaemonConfig {
  apiUrl: string;              // SignalDB API base URL
  projectKey: string;          // SignalDB project API key
  machineId: string;           // Unique machine identifier
  heartbeatIntervalMs: number; // Default: 10000
  sse: {
    endpoint: string;          // Default: "/v1/messages/stream"
    lastEventId: string | null;
    reconnectBaseMs: number;   // Default: 1000
    reconnectMaxMs: number;    // Default: 30000
    reconnectMultiplier: number; // Default: 2
  };
}
```

## Troubleshooting

### SSE Connection Dies Silently

**Symptoms**: Agent shows "active" but doesn't receive messages.

**Cause**: SSE stream closes without error; heartbeat continues independently.

**Fix**: The daemon now runs an SSE health check every 5s during discovery polling. If `isConnected` is false, it disconnects the old client and creates a fresh SSE connection. Keepalive failures also log at warn level instead of being silently swallowed.

**Debug**: Set `COMMS_LOG_LEVEL=debug` to see keepalive ping results.

### Session Not Found

**Symptoms**: "No local session matches target address" errors.

**Cause**: `claude --resume` must run from the session's original project directory.

**Fix**: The daemon passes `cwd: projectPath` when spawning Claude. Discovery reads `cwd` from `~/.claude/global-sessions.json`.

### snake_case / camelCase Mismatch

**Symptoms**: Fields like `senderId` are empty or undefined.

**Cause**: SignalDB returns `snake_case` (e.g., `sender_id`), but the Message interface uses `camelCase`.

**Fix**: SSE client converts keys during message parsing. SignalDB REST client also auto-converts via field aliases.

### Claude Doesn't Know About COMMS

**Symptoms**: Claude responds conversationally instead of executing the COMMS request.

**Cause**: Previously, no context was injected -- Claude saw raw text with no indication it came from COMMS.

**Fix**: The router now injects a system prompt via `--append-system-prompt` telling Claude about the COMMS context, sender, and expected behavior.

## Key Pitfalls

1. **SignalDB SSE format**: Events use `event: insert` (not default `message`). Data is nested as `{id, data: {...}, ts}`.
2. **`decodeProjectPath()` fails for hyphens**: Use `cwd` from global-sessions.json instead.
3. **`claude --resume` requires cwd**: Must run from the session's original project directory.
4. **Heartbeat masks SSE death**: Heartbeat is independent of SSE. A healthy heartbeat doesn't mean SSE is alive.
5. **Discovery polling errors**: Previously silently swallowed. Now logged at warn level.
