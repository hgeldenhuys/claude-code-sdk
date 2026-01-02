You are executing the `/librarian:ask` command to interact with the Librarian - a persistent sub-agent loaded with the semantic file index (Library) for file discovery.

## Automatic Session ID Detection

The UserPromptSubmit hook automatically echoes the session ID. Extract it from the system reminder that says "Session: {uuid}".

Example system reminder:
```
UserPromptSubmit hook success: Session: 6f0e69c0-6a6a-4271-a36e-f57319ee6d36
```

Extract just the UUID part after "Session: ".

## Command Syntax

- `/librarian:ask create` - Initialize librarian with catalog + common shards
- `/librarian:ask <question>` - Query the librarian about file locations

## Workflow

**Step 1: Extract session ID**
- Look for "Session: " in recent system reminders
- Extract the UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
- If not found, read from most recent UserPromptSubmit hook event

**Step 2: Check librarian status for this session**
- Read `.agent/librarian/librarian.json`
- Look up current session_id in the `sessions` object
- Check if `agent_id` exists and is not null

**Step 3a: If creating librarian (or librarian doesn't exist)**
1. **DO NOT** read shard files in main agent - this bloats your context!

2. Use Task tool with `subagent_type="librarian"` and `model="haiku"` to spawn librarian:
   ```
   You are the Librarian - a persistent file discovery specialist for this project's semantic Library index.

   **CRITICAL CONSTRAINT:** You have Read tool access ONLY for this initial load. After loading the catalog and initial shards, you will NEVER use Read again.

   **Your First and ONLY Task:**
   Load the Library index by reading these files:

   **Required (always load):**
   - .agent/librarian/shards/catalog.json (catalog of all 80+ shards)

   **Common shards (load these for broad coverage):**
   - .agent/librarian/shards/domain-crm.json (113 CRM files)
   - .agent/librarian/shards/domain-core.json (119 core utilities)
   - .agent/librarian/shards/domain-real-time.json (8 SSE/streaming files)
   - .agent/librarian/shards/layer-routes.json (96 API endpoints)
   - .agent/librarian/shards/layer-service.json (109 business logic files)
   - .agent/librarian/shards/layer-worker.json (30 background jobs)

   Use the Read tool 7 times to load catalog + 6 common shards. This gives you coverage of ~500 files.

   **🚨 ABSOLUTE PROHIBITION: NO TOOLS AFTER INITIAL LOAD 🚨**

   After you confirm "Catalog + 6 shards loaded", you are FORBIDDEN from using ANY tools:
   - ❌ NO Read tool (you already have the index in memory)
   - ❌ NO Grep tool (search your loaded shards instead)
   - ❌ NO Bash tool (you are a file discovery system, not a research system)
   - ❌ NO other tools whatsoever

   **If you find yourself wanting to use a tool, STOP and answer from memory instead.**

   Your ONLY job after loading: Search loaded shards and return file metadata.

   **Your Retrieval-Only Role:**
   - Answer "which file" questions using ONLY the shards you loaded into memory
   - Search by: purpose, domain, layer, patterns, complexity, importance
   - Return: file paths + purposes + relevant metadata
   - If a query needs a shard you didn't load, say "That shard wasn't loaded; query suggests loading domain-X.json"
   - Reference catalog to suggest which shard to load
   - NEVER say "let me read the file" - you already read the relevant shards!

   Confirm when you've loaded catalog + 6 common shards (should take EXACTLY 7 Read calls), then answer ALL subsequent questions using ZERO tools.
   ```

3. Query database for agent_id:
   ```sql
   SELECT payload->'event'->>'agent_id' as agent_id
   FROM hook_events
   WHERE event_name = 'SubagentStop'
     AND session_id = '{current_session_id}'
   ORDER BY created_at DESC
   LIMIT 1;
   ```

4. Update `.agent/librarian/librarian.json`:
   ```json
   {
     "sessions": {
       "{session_id}": {
         "agent_id": "{captured_agent_id}",
         "created_at": "{timestamp}",
         "last_synced": "{timestamp}",
         "library_version": "1.0.0",
         "shards_loaded": ["catalog", "domain-crm", "domain-core", "domain-real-time", "layer-routes", "layer-service", "layer-worker"],
         "status": "initialized"
       }
     }
   }
   ```

**Step 3b: If querying existing librarian**
1. Extract agent_id from shadow.json for current session

2. Use Task tool with `resume=agent_id`, `model="haiku"` to query:
   ```
   subagent_type: "librarian"
   model: "haiku"
   prompt: "REMINDER: You already loaded catalog + 6 common shards. Answer using ONLY your loaded memory. DO NOT use any tools.

   Question: {user's question}

   Search your loaded shards (catalog, domain-crm, domain-core, domain-real-time, layer-routes, layer-service, layer-worker) and return matching files with their metadata.

   If the query needs a shard you don't have loaded, tell me which shard from the catalog would have that information."
   resume: "{agent_id_from_librarian_json}"
   ```

**Response to User:**
After librarian responds, present the results in a clean format:
- File count and summary
- List of files with paths and purposes
- Relevant metadata (domain, layer, patterns, complexity)
- Suggestions for related files or shards if helpful

## Examples

**Creating the librarian:**
```
User: /librarian:ask create
Assistant: Initializing Librarian agent...
[Creates librarian, loads catalog + 6 shards]
Assistant: ✅ Librarian initialized with catalog + 6 common shards (~500 files indexed)

Ready to answer file discovery questions!
```

**Querying for campaign files:**
```
User: /librarian:ask which files handle campaign scheduling?
Assistant: [Queries librarian agent]

Found 4 campaign scheduling files:

1. apps/api/src/modules/crm/routes/campaign-schedules.ts
   - Purpose: CRM campaign schedules HTTP routes
   - Layer: routes, Domain: crm
   - Patterns: SSE, CQRS

2. apps/api/src/modules/crm/services/campaign-schedules.ts
   - Purpose: Campaign scheduling business logic
   - Layer: service, Domain: crm

3. apps/api/src/workers/campaign-scheduler.ts
   - Purpose: Background worker for campaign scheduling
   - Layer: worker, Domain: background-jobs
   - Complexity: high

4. packages/db/src/schema/campaign-schedules.ts
   - Purpose: Campaign schedule database schema
   - Layer: schema, Domain: crm
```

**Finding SSE examples:**
```
User: /librarian:ask show me SSE streaming implementations
Assistant: [Queries librarian agent]

Found 6 SSE streaming files in domain-real-time shard:

1. apps/api/src/lib/electric-client.ts - ElectricSQL client singleton
2. apps/api/src/routes/stream.ts - Main SSE streaming routes
3. apps/api/src/routes/stream/analytics-metrics.ts - Analytics SSE
[...]
```

## Performance

- First query (create): ~20-30s (loads 7 shards)
- Subsequent queries: ~5-10s (pure memory retrieval)
- Token efficiency: ~8K tokens (catalog + 6 shards) vs 17K for full index (53% savings)
- Cost: ~$0.05 creation, ~$0.01 per query

## Complementary Commands

- `/weave:shadow` - Query institutional knowledge (pain points, patterns, decisions)
- `/librarian:ask` - Query structural knowledge (file locations, architecture)
- Use grep for exact string matching
- Use Explore agent for deep code analysis
