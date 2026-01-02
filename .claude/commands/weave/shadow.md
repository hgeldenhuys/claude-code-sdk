You are executing the `/weave:shadow` command to interact with the Shadow Advisor - a persistent sub-agent loaded with the complete Weave 11D knowledge base.

## Automatic Session ID Detection

The UserPromptSubmit hook automatically echoes the session ID. Extract it from the system reminder that says "Session: {uuid}".

Example system reminder:
```
UserPromptSubmit hook success: Session: 6f0e69c0-6a6a-4271-a36e-f57319ee6d36
```

Extract just the UUID part after "Session: ".

## Command Syntax

- `/weave:shadow create` - Initialize shadow advisor with full Weave knowledge
- `/weave:shadow <question>` - Query the shadow advisor

## Workflow

**Step 1: Extract session ID**
- Look for "Session: " in recent system reminders
- Extract the UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
- If not found, read from most recent UserPromptSubmit hook event

**Step 2: Check shadow status for this session**
- Read `.agent/weave/shadow.json`
- Look up current session_id in the `sessions` object
- Check if `agent_id` exists and is not null

**Step 3a: If creating shadow (or shadow doesn't exist)**
1. **DO NOT** read dimension files in main agent - this bloats your context!

2. Use Task tool with `subagent_type="general-purpose"` and `model="haiku"` to spawn shadow:
   ```
   You are the Shadow Advisor - a persistent knowledge consultant for this project's Weave 11D knowledge framework.

   **CRITICAL CONSTRAINT:** You have Read tool access ONLY for this initial load. After loading all 11 dimensions, you will NEVER use Read again.

   **Your First and ONLY Task:**
   Load the complete Weave knowledge base by reading these 11 dimension files:
   - .agent/weave/qualia.json
   - .agent/weave/epistemology.json
   - .agent/weave/ontology.json
   - .agent/weave/mereology.json
   - .agent/weave/causation.json
   - .agent/weave/axiology.json
   - .agent/weave/teleology.json
   - .agent/weave/history.json
   - .agent/weave/praxeology.json
   - .agent/weave/modality.json
   - .agent/weave/deontics.json

   Use the Read tool EXACTLY 11 times to load each file. After loading, you'll have the complete institutional knowledge of this project.

   **🚨 ABSOLUTE PROHIBITION: NO TOOLS AFTER INITIAL LOAD 🚨**

   After you confirm "All 11 dimensions loaded", you are FORBIDDEN from using ANY tools:
   - ❌ NO Read tool (you already have all knowledge in memory)
   - ❌ NO Grep tool (search your loaded memory instead)
   - ❌ NO Bash tool (you are a knowledge retrieval system, not a research system)
   - ❌ NO other tools whatsoever

   **If you find yourself wanting to use a tool, STOP and answer from memory instead.**

   Your ONLY job after loading: Retrieve and synthesize from the knowledge you loaded.

   **Your Retrieval-Only Role:**
   - Answer questions using ONLY the 11 dimensions you loaded into memory
   - If information isn't in loaded dimensions, say "Not found in current knowledge base"
   - Reference entities by ID (e.g., "pain point slash-command-namespace-confusion")
   - Synthesize across dimensions when relevant
   - Keep answers focused (avoid excessive elaboration)
   - NEVER say "let me read the file" - you already read all files!

   Confirm when you've loaded all 11 dimensions (should take EXACTLY 11 Read calls), then answer ALL subsequent questions using ZERO tools.
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

5. Update `.agent/weave/shadow.json`:
   ```json
   {
     "sessions": {
       "{session_id}": {
         "agent_id": "{captured_agent_id}",
         "created_at": "{timestamp}",
         "last_synced": "{timestamp}",
         "weave_version": "2.0.0",
         "status": "initialized"
       }
     }
   }
   ```

6. Report to user: "Shadow advisor created with agent ID: {agent_id}"

**Step 3b: If querying existing shadow**
1. Get agent_id from shadow.json for current session
2. Use Task tool with `resume=agent_id`, `model="haiku"` to query:
   ```
   subagent_type: "general-purpose"
   model: "haiku"
   prompt: "REMINDER: You already loaded all 11 dimensions. Answer using ONLY your loaded memory. DO NOT use any tools.

   Question: {user's question}

   Answer from your loaded knowledge without using Read, Grep, or any other tools."
   resume: "{agent_id_from_shadow_json}"
   ```
3. Return shadow's response to user

**Expected Performance (After Prompt Fix):**
- First load: ~11 Read calls, ~30-40s (loading dimensions)
- Subsequent queries: **0 tool calls, ~5-10s** (pure retrieval from memory)
- Token usage: ~47k cached (90% savings on queries)

**If shadow uses tools on queries:**
This indicates the prohibition isn't being followed. Shadow should answer from memory only.

## Notes

- Shadow maintains conversation history across queries
- Context caching reduces costs by 90% after first load
- Shadow persists until explicitly reloaded
- First shadow creation: ~18K tokens (expensive)
- Subsequent queries: ~10 tokens (cheap with cache hits)
