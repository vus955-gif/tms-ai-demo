import { Fragment } from "react";

/** The driver's order page link, as the order SMS carries it. */
const DRIVER_LINK = /(https?:\/\/\S+\/k\/[A-Za-z0-9_-]{16,64})/;

/**
 * SMS text with the driver's order link made clickable. Only that one kind of link, and only its
 * path is used — whatever host the SMS names, the click stays on this app (message text is not trusted).
 */
export function MessageText({ body, className }: { body: string; className?: string }) {
  const parts = body.split(DRIVER_LINK);
  return (
    <p className={className}>
      {parts.map((part, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        let path: string;
        try {
          path = new URL(part).pathname;
        } catch {
          return <Fragment key={i}>{part}</Fragment>;
        }
        return (
          <a key={i} href={path} target="_blank" rel="noreferrer" className="break-all underline underline-offset-2" data-testid="driver-link">
            {part}
          </a>
        );
      })}
    </p>
  );
}
