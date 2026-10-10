import { FileText } from "lucide-react";
import { ComingSoon } from "@/components/shell/coming-soon";

export default function DocumentsPage() {
  return (
    <ComingSoon
      icon={FileText}
      title="Dokumenty CMR"
      stage="3"
      items={[
        "Odczyt zdjęć CMR przesłanych MMS-em lub mailem",
        "Kontrola jakości: czytelność, pieczątka, podpis, adnotacje",
        "Kolejki „Do zamknięcia” i „Do weryfikacji”",
      ]}
    />
  );
}
