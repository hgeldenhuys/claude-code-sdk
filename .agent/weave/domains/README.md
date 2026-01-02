# Weave Domains

Browse knowledge by functional area.

## Available Domains

### [CRM](crm.md) - Customer Relationship Management
**Entities:** Campaigns, Contacts, Leads, Recipients, Messages
**Patterns:** List operations, enrichment, real-time sync
**Purposes:** Lead management, campaign orchestration
**When to use:** Working on CRM features, contact management, campaign logic

### [Real-time](realtime.md) - Streaming & Live Updates
**Entities:** SSE Pattern, CQRS architecture
**Patterns:** SSE+GET, query invalidation, BroadcastChannel pooling
**Purposes:** Real-time updates, live dashboards
**When to use:** Working on SSE, streaming, live data features

### [Knowledge](knowledge.md) - Weave System Itself
**Entities:** Weave framework, extraction, monitoring
**Patterns:** Stop hook, automatic extraction, progressive disclosure
**Purposes:** Knowledge capture, session continuity
**When to use:** Working on Weave, improving knowledge capture

### [Auth](auth.md) - Authentication & Authorization
**Entities:** Clerk integration, session management
**Patterns:** JWT validation, role-based access
**Purposes:** Secure access, user identity
**When to use:** Working on auth, permissions, security

## How Domains Work

Each domain file contains:
- **Overview** - What this domain covers
- **Key Entities** - Main components (with links to full data)
- **Patterns** - How things work in this domain
- **Purposes** - Why these things exist
- **Quick Queries** - Common bash script queries

## Adding New Domains

When a new functional area emerges:
1. Create `domains/<name>.md`
2. Follow the template structure
3. Link entities from relevant dimensions
4. Update this README

## Token Efficiency

- This file: ~300 tokens
- Each domain file: ~1K tokens
- Load only the domain you're working on
- Total: 1-2K tokens vs 18K for all dimensions

## Navigation Tips

**By feature work:**
- Working on campaigns? → [crm.md](crm.md)
- Working on live updates? → [realtime.md](realtime.md)
- Working on Weave? → [knowledge.md](knowledge.md)

**By knowledge type:**
- Need purposes? → Use [dimensions/teleology.md](../dimensions/teleology.md) instead
- Need patterns? → Use [dimensions/praxeology.md](../dimensions/praxeology.md) instead
- Need history? → Use [dimensions/history.md](../dimensions/history.md) instead

**Domains = functional areas** (what you're building)
**Dimensions = knowledge types** (how you're thinking)
