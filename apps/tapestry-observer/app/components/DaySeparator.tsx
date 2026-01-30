/**
 * DaySeparator Component
 *
 * Horizontal rule with date label between message groups.
 */

interface DaySeparatorProps {
  date: Date;
}

export function DaySeparator({ date }: DaySeparatorProps) {
  const label = date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex items-center gap-3 py-3 px-4">
      <div className="flex-1 border-t border-gray-800" />
      <span className="text-xs text-gray-500 flex-shrink-0">{label}</span>
      <div className="flex-1 border-t border-gray-800" />
    </div>
  );
}
