/**
 * StatusIndicator Component
 *
 * Visual indicator for agent/connection status.
 */

import type { AgentStatus } from "~/lib/types";

interface StatusIndicatorProps {
  status: AgentStatus;
  size?: "sm" | "md" | "lg";
  pulse?: boolean;
}

const sizeClasses = {
  sm: "w-2 h-2",
  md: "w-2.5 h-2.5",
  lg: "w-3 h-3",
};

const colorClasses: Record<AgentStatus, string> = {
  active: "bg-green-500",
  idle: "bg-yellow-500",
  offline: "bg-gray-500",
};

export function StatusIndicator({
  status,
  size = "md",
  pulse = false,
}: StatusIndicatorProps) {
  return (
    <span
      className={`
        inline-block rounded-full
        ${sizeClasses[size]}
        ${colorClasses[status]}
        ${pulse && status === "active" ? "animate-pulse-green" : ""}
      `}
      title={status}
    />
  );
}

// ============================================================================
// Status Badge
// ============================================================================

interface StatusBadgeProps {
  status: AgentStatus;
}

const badgeClasses: Record<AgentStatus, string> = {
  active: "bg-green-900/50 text-green-400 border-green-700",
  idle: "bg-yellow-900/50 text-yellow-400 border-yellow-700",
  offline: "bg-gray-800 text-gray-400 border-gray-600",
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center gap-1.5 px-2 py-0.5
        text-xs font-medium rounded-full border
        ${badgeClasses[status]}
      `}
    >
      <StatusIndicator status={status} size="sm" pulse={status === "active"} />
      {status}
    </span>
  );
}
