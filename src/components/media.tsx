import { cn } from "@/lib/utils";

export interface MediaProps {
  kind: "image" | "audio" | "video";
  url: string;
  alt?: string;
  partial?: boolean;
  className?: string;
}

export function StreamMedia({
  kind,
  url,
  alt = "Generated asset",
  partial,
  className,
}: MediaProps) {
  if (kind === "image") {
    return (
      <img
        className={cn("cm-stream-media cm-stream-media--image", partial && "cm-stream-media--partial", className)}
        src={url}
        alt={alt}
        loading="lazy"
        decoding="async"
      />
    );
  }

  if (kind === "audio") {
    return (
      <audio
        className={cn("cm-stream-media cm-stream-media--audio", className)}
        controls
        preload="metadata"
        src={url}
      />
    );
  }

  return (
    <video
      className={cn("cm-stream-media cm-stream-media--video", partial && "cm-stream-media--partial", className)}
      controls
      preload="metadata"
      src={url}
    />
  );
}
