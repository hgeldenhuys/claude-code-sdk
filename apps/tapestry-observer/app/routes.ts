import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // Layout wraps all UI routes
  layout("routes/layout.tsx", [
    index("routes/dashboard.tsx"),
    route("agents", "routes/agents.tsx"),
    route("agents/:agentId", "routes/agent-detail.tsx"),
    route("chat", "routes/chat.tsx"),
    route("chat/:threadId", "routes/chat-thread.tsx"),
    route("mail", "routes/mail.tsx"),
    route("mail/:messageId", "routes/mail-detail.tsx"),
    route("channels", "routes/channels.tsx"),
    route("channels/:channelId", "routes/channel-detail.tsx"),
    route("memos", "routes/memos.tsx"),
    route("pastes", "routes/pastes.tsx"),
    route("compose", "routes/compose.tsx"),
  ]),
  // API routes (no layout)
  route("api/health", "routes/api.health.ts"),
  route("api/config", "routes/api.config.ts"),
  route("api/proxy/*", "routes/api.proxy.$.ts"),
] satisfies RouteConfig;
