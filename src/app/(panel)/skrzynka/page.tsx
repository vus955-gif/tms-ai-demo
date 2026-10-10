import { Mail } from "lucide-react";
import { ComingSoon } from "@/components/shell/coming-soon";

export default function InboxPage() {
  return (
    <ComingSoon
      icon={Mail}
      title="Skrzynka klientów"
      stage="3b"
      items={[
        "Maile od klientów z kategorią nadaną przez AI",
        "Szkic zlecenia z maila z zamówieniem",
        "Szkic odpowiedzi na pytanie „gdzie jest auto?”",
      ]}
    />
  );
}
