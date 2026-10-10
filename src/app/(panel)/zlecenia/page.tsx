import { ClipboardList } from "lucide-react";
import { ComingSoon } from "@/components/shell/coming-soon";

export default function OrdersPage() {
  return (
    <ComingSoon
      icon={ClipboardList}
      title="Zlecenia"
      stage="2"
      items={[
        "Panel zleceń dla każdego kierowcy z kolejką",
        "„Klocki” dopasowania kierowcy do zlecenia z uzasadnieniem",
        "Przydział przeciąganiem i SMS ze zleceniem z szablonu",
      ]}
    />
  );
}
