import { MessageSquare } from "lucide-react";
import { ComingSoon } from "@/components/shell/coming-soon";

export default function MessengerPage() {
  return (
    <ComingSoon
      icon={MessageSquare}
      title="Komunikator z kierowcami"
      stage="2"
      items={[
        "Wątki z kierowcami i odpowiedzi wysyłane z programu",
        "Priorytety i kategorie wiadomości nadawane przez AI",
        "Gotowe odpowiedzi do wysłania jednym kliknięciem",
      ]}
    />
  );
}
