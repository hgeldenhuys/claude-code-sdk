import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  layout("routes/layout.tsx", [
    index("routes/home.tsx"),
    route("agents", "routes/agents.tsx"),
    route("channels", "routes/channels.tsx"),
    route("messages", "routes/messages.tsx"),
    route("messages/thread/:threadId", "routes/messages.thread.tsx"),
  ]),
  route("api/proxy/*", "routes/api.proxy.$.ts"),
  route("api/config", "routes/api.config.ts"),
] satisfies RouteConfig;
