/**
 * CategoryPill Component
 *
 * Colored category tag pill for memos.
 */

const CATEGORY_COLORS: Record<string, string> = {
  general: "bg-gray-700 text-gray-300",
  security: "bg-red-900/50 text-red-400",
  policy: "bg-purple-900/50 text-purple-400",
  deployment: "bg-blue-900/50 text-blue-400",
  maintenance: "bg-yellow-900/50 text-yellow-400",
  incident: "bg-orange-900/50 text-orange-400",
};

interface CategoryPillProps {
  category: string;
  onClick?: () => void;
  active?: boolean;
}

export function CategoryPill({ category, onClick, active }: CategoryPillProps) {
  const baseColor = CATEGORY_COLORS[category] || "bg-gray-700 text-gray-300";
  const activeRing = active ? "ring-1 ring-blue-500" : "";

  const Tag = onClick ? "button" : "span";

  return (
    <Tag
      onClick={onClick}
      className={`text-xs px-2 py-0.5 rounded-full ${baseColor} ${activeRing} ${
        onClick ? "cursor-pointer hover:opacity-80 transition-opacity" : ""
      }`}
    >
      {category}
    </Tag>
  );
}
