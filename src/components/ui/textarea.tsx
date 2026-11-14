import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "cm-field-input flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

function JsonParamTextarea({
  value,
  placeholder,
  onValidChange,
}: {
  value: unknown
  placeholder: string
  onValidChange: (next: unknown) => void
}) {
  const serialized = value === undefined ? "" : JSON.stringify(value, null, 2)
  const [draft, setDraft] = React.useState(serialized)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setDraft((prev) => {
      try {
        if (prev.trim() === "" && value === undefined) return prev
        if (prev.trim() !== "" && JSON.stringify(JSON.parse(prev)) === JSON.stringify(value)) {
          return prev
        }
      } catch {
        return prev
      }
      return serialized
    })
  }, [serialized, value])

  return (
    <div className="space-y-1">
      <Textarea
        className="cm-model-card__field font-mono text-xs min-h-16"
        value={draft}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          const nextDraft = event.target.value
          setDraft(nextDraft)
          const trimmed = nextDraft.trim()
          if (!trimmed) {
            setError(null)
            onValidChange(undefined)
            return
          }
          try {
            const parsed = JSON.parse(trimmed)
            setError(null)
            onValidChange(parsed)
          } catch (err) {
            setError(err instanceof Error ? err.message : "Invalid JSON")
          }
        }}
      />
      {error ? <p className="text-[11px] font-mono text-red-400">{error}</p> : null}
    </div>
  )
}

export { Textarea, JsonParamTextarea }
