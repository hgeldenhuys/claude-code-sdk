/**
 * Sidebar Navigation Component
 *
 * Organized into sections: Overview, COMMS, and Transcripts.
 * Uses lightweight counts from the provider (not full data arrays).
 */

import { NavLink } from "react-router";
import { useSignalDB } from "~/lib/signaldb";
import { isChatMessage, isMailMessage } from "~/lib/types";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  badge?: number;
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-4 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
      {label}
    </div>
  );
}

export function Sidebar() {
  const { agents, channels, messages, transcriptCounts } = useSignalDB();

  let chatCount = 0;
  let mailCount = 0;
  let memoCount = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (isChatMessage(m)) chatCount++;
    if (isMailMessage(m)) mailCount++;
    if (m.messageType === "memo") memoCount++;
  }

  const overviewItems: NavItem[] = [
    { to: "/", label: "Dashboard", icon: "\u25C9" },
  ];

  const commsItems: NavItem[] = [
    { to: "/agents", label: "Agents", icon: "\u2B21", badge: agents.length },
    { to: "/chat", label: "Chat", icon: "\u25C7", badge: chatCount },
    { to: "/mail", label: "Mail", icon: "\u2709", badge: mailCount },
    { to: "/channels", label: "Channels", icon: "#", badge: channels.length },
    { to: "/memos", label: "Memos", icon: "\u25A4", badge: memoCount },
    { to: "/pastes", label: "Pastes", icon: "\u29C9" },
    { to: "/compose", label: "Send", icon: "\u27A4" },
  ];

  const transcriptItems: NavItem[] = [
    { to: "/sessions", label: "Sessions", icon: "\u2630", badge: transcriptCounts.sessions },
    { to: "/search", label: "Search", icon: "\u2315" },
    { to: "/hooks", label: "Hook Events", icon: "\u26A1", badge: transcriptCounts.hookEvents },
    { to: "/analytics", label: "Analytics", icon: "\uD83D\uDCCA" },
  ];

  return (
    <nav className="flex flex-col h-full w-48 bg-gray-900/50 border-r border-gray-800">
      <div className="flex-1 py-2 overflow-y-auto">
        <SectionHeader label="Overview" />
        {renderNavItems(overviewItems)}
        <SectionHeader label="COMMS" />
        {renderNavItems(commsItems)}
        <SectionHeader label="Transcripts" />
        {renderNavItems(transcriptItems)}
      </div>
    </nav>
  );
}

function renderNavItems(items: NavItem[]) {
  return items.map((item) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.to === "/"}
      className={({ isActive }) =>
        `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
          isActive
            ? "bg-gray-800 text-gray-100 border-r-2 border-blue-500"
            : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
        }`
      }
    >
      <span className="text-base w-5 text-center font-mono">{item.icon}</span>
      <span className="flex-1">{item.label}</span>
      {item.badge !== undefined && item.badge > 0 && (
        <span className="text-xs bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
          {item.badge > 999 ? "999+" : item.badge}
        </span>
      )}
    </NavLink>
  ));
}
