"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useResetWorld, type ClientSnapshot } from "@/hooks/use-snapshot";

export function ResetDialog({ snapshot }: { snapshot: ClientSnapshot | undefined }) {
  const [open, setOpen] = useState(false);
  const [randomRun, setRandomRun] = useState(false);
  const reset = useResetWorld();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setRandomRun(snapshot?.randomRun ?? false);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Zacznij demo od nowa" data-testid="reset-open">
          <RotateCcw />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Zacząć demo od nowa?</DialogTitle>
          <DialogDescription>
            Wszystkie zmiany w tym świecie demo zostaną usunięte, a symulacja wróci do godziny 8:30.
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--brand)]"
            checked={randomRun}
            onChange={(e) => setRandomRun(e.target.checked)}
          />
          <span>
            Losowy przebieg
            <span className="block text-muted-foreground">
              Kierowcy odpowiadają inaczej niż w standardowym pokazie. Bez zaznaczenia każdy pokaz przebiega tak samo.
            </span>
          </span>
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Anuluj
          </Button>
          <Button
            data-testid="reset-confirm"
            disabled={reset.isPending}
            onClick={() =>
              reset.mutate(
                { randomRun },
                {
                  onSuccess: () => {
                    setOpen(false);
                    toast.success("Demo zaczęło się od nowa");
                  },
                  onError: (e) => toast.error(e.message),
                },
              )
            }
          >
            Zacznij od nowa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
