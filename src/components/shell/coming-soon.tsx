import type { LucideIcon } from "lucide-react";

export function ComingSoon({ icon: Icon, title, stage, items }: { icon: LucideIcon; title: string; stage: string; items: string[] }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 p-10">
      <span className="flex size-10 items-center justify-center rounded-lg bg-accent">
        <Icon className="size-5 text-muted-foreground" aria-hidden />
      </span>
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">Ta część powstaje w etapie {stage}.</p>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
