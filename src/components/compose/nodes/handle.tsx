import { Handle, Position } from "@xyflow/react";
import { Plus } from "lucide-react";

const handleBaseStyle = "!w-4 !h-4 !rounded-full !border-2 transition-all";
export const inputHandleStyle = `${handleBaseStyle} !-left-2 !bg-cyan-500 !border-cyan-300 !shadow-md !shadow-cyan-500/60 hover:!shadow-lg hover:!shadow-cyan-400/80`;
export const outputHandleStyle = `${handleBaseStyle} !-right-2 !bg-fuchsia-500 !border-fuchsia-300 !shadow-md !shadow-fuchsia-500/60 hover:!shadow-lg hover:!shadow-fuchsia-400/80`;

const positionStyles: Record<Position, string> = {
  [Position.Left]: "!-left-2.5",
  [Position.Right]: "!-right-2.5",
  [Position.Top]: "!-top-2.5",
  [Position.Bottom]: "!-bottom-2.5",
};

export function DirectionalHandle({
  type,
  position,
  id,
  isConnected = false,
}: {
  type: "source" | "target";
  position: Position;
  id: string;
  isConnected?: boolean;
}) {
  const baseStyle = type === "source" ? outputHandleStyle : inputHandleStyle;

  return (
    <Handle
      type={type}
      position={position}
      id={`${id}-${position}`}
      className={`${baseStyle} ${positionStyles[position]} ${!isConnected ? "!bg-muted flex items-center justify-center" : ""}`}
    >
      {!isConnected && (
        <Plus className="w-2.5 h-2.5 text-muted-foreground pointer-events-none" />
      )}
    </Handle>
  );
}
