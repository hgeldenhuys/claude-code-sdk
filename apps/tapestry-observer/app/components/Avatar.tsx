/**
 * Avatar Component
 *
 * Agent avatar circle with first letter of name and consistent color from ID hash.
 */

const AVATAR_COLORS = [
  "bg-blue-600",
  "bg-emerald-600",
  "bg-purple-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-cyan-600",
  "bg-indigo-600",
  "bg-teal-600",
];

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

interface AvatarProps {
  name: string;
  id: string;
  size?: "sm" | "md" | "lg";
}

export function Avatar({ name, id, size = "md" }: AvatarProps) {
  const colorIndex = hashCode(id) % AVATAR_COLORS.length;
  const color = AVATAR_COLORS[colorIndex];
  const letter = (name || "?")[0]!.toUpperCase();

  const sizeClasses = {
    sm: "w-6 h-6 text-xs",
    md: "w-8 h-8 text-sm",
    lg: "w-10 h-10 text-base",
  };

  return (
    <div
      className={`${color} ${sizeClasses[size]} rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0`}
      title={name}
    >
      {letter}
    </div>
  );
}
