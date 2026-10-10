import { Map } from "lucide-react";
import { ComingSoon } from "@/components/shell/coming-soon";

export default function MonitoringPage() {
  return (
    <ComingSoon
      icon={Map}
      title="Monitoring floty"
      stage="1"
      items={[
        "Mapa z pozycjami 14 pojazdów i lista z czasem jazdy oraz ETA",
        "Stany zielony / żółty / czerwony liczone z przepisów 561/2006",
        "Alerty AI z wyjaśnieniem i propozycją objazdu",
      ]}
    />
  );
}
