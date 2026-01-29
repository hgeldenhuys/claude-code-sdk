import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("api/health", "routes/api.health.ts"),
  route("api/proxy/*", "routes/api.proxy.$.ts"),
] satisfies RouteConfig;
