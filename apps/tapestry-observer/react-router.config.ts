import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "app",
  ssr: true, // Enable SSR for API routes to work
} satisfies Config;
