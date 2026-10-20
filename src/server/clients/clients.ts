import { randomUUID } from "node:crypto";
import { and, eq, inArray, notInArray, or } from "drizzle-orm";
import { z } from "zod";
import { registerPointCoords } from "@/adapters/routing/static-routes";
import { clientContacts, clients, orders, orderTemplates, points } from "@/db/schema";
import type { Executor } from "@/db/types";
import { COUNTRY_CODES, COUNTRY_NAMES, inCountry } from "@/domain/countries";
import { checkTaxId } from "@/domain/tax-id";
import { HttpError } from "../http";

/** A public demo: room for a realistic book of clients, not for filling the database. */
export const LIMITS = { clients: 30, contactsPerClient: 10, manualPoints: 60 } as const;

/** Free mailboxes say nothing about the company, so they are not used as the client's domain. */
const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "wp.pl", "o2.pl", "onet.pl", "op.pl", "interia.pl", "poczta.fm", "gazeta.pl", "tlen.pl", "proton.me", "protonmail.com", "gmx.de", "web.de"]);

/** Validation lives here, not only at the API edge, so no caller can skip it. */
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => i.message).join("; "));
  return r.data;
}

const newId = (prefix: string) => `${prefix}-x-${randomUUID().replace(/-/g, "").slice(0, 10)}`;

const ContactSchema = z.object({
  name: z.string().trim().min(2, "Osoba: co najmniej 2 znaki").max(80, "Osoba: najwyżej 80 znaków"),
  email: z.email("Podaj poprawny adres e-mail").max(120, "E-mail: najwyżej 120 znaków"),
  phone: z.string().trim().max(30, "Telefon: najwyżej 30 znaków").default(""),
});

export const ClientInputSchema = z.object({
  name: z.string().trim().min(2, "Nazwa: co najmniej 2 znaki").max(120, "Nazwa: najwyżej 120 znaków"),
  taxId: z.string().trim().max(24, "NIP/VAT: najwyżej 24 znaki").default(""),
  isKey: z.boolean().default(false),
  contact: ContactSchema,
});

export const ClientUpdateSchema = z.object({
  name: z.string().trim().min(2, "Nazwa: co najmniej 2 znaki").max(120, "Nazwa: najwyżej 120 znaków").optional(),
  isKey: z.boolean().optional(),
});

export const ContactInputSchema = ContactSchema;

const PointFields = {
  name: z.string().trim().min(2, "Nazwa punktu: co najmniej 2 znaki").max(120, "Nazwa punktu: najwyżej 120 znaków"),
  address: z.string().trim().min(3, "Podaj adres").max(200, "Adres: najwyżej 200 znaków"),
  city: z.string().trim().min(2, "Podaj miejscowość").max(80, "Miejscowość: najwyżej 80 znaków"),
  openingHours: z.string().trim().max(120, "Godziny: najwyżej 120 znaków").default(""),
  requirements: z.string().trim().max(300, "Wymagania: najwyżej 300 znaków").default(""),
  notes: z.string().trim().max(500, "Notatki: najwyżej 500 znaków").default(""),
  handlingMinutes: z.number({ error: "Czas załadunku/rozładunku: podaj minuty" }).int().min(10, "Czas obsługi: co najmniej 10 min").max(240, "Czas obsługi: najwyżej 240 min").default(45),
};

export const PointInputSchema = z
  .object({
    ...PointFields,
    country: z.enum(COUNTRY_CODES, { error: "Wybierz kraj" }),
    lat: z.number({ error: "Wskaż punkt na mapie" }).min(-90).max(90),
    lng: z.number({ error: "Wskaż punkt na mapie" }).min(-180).max(180),
  })
  .superRefine((p, ctx) => {
    // The country drives the domestic/international rules, so it must match the pin.
    if (!inCountry(p.country, p.lng, p.lat)) ctx.addIssue({ code: "custom", message: `Punkt na mapie leży poza krajem ${COUNTRY_NAMES[p.country]} — sprawdź kraj albo miejsce na mapie` });
  });

/** Text fields only: the location is fixed once saved (routes and orders already use it). */
export const PointUpdateSchema = z.object({
  name: PointFields.name.optional(),
  address: PointFields.address.optional(),
  city: PointFields.city.optional(),
  openingHours: z.string().trim().max(120, "Godziny: najwyżej 120 znaków").optional(),
  requirements: z.string().trim().max(300, "Wymagania: najwyżej 300 znaków").optional(),
  notes: z.string().trim().max(500, "Notatki: najwyżej 500 znaków").optional(),
  handlingMinutes: z.number().int().min(10).max(240).optional(),
});

function domainOf(email: string): string {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return FREE_MAIL.has(domain) ? "" : domain;
}

async function requireClient(db: Executor, sandboxId: string, clientId: string) {
  const [client] = await db.select().from(clients).where(and(eq(clients.sandboxId, sandboxId), eq(clients.id, clientId)));
  if (!client) throw new HttpError(404, "Nie ma takiego klienta.");
  return client;
}

export async function createClient(db: Executor, sandboxId: string, raw: z.input<typeof ClientInputSchema>) {
  const input = parse(ClientInputSchema, raw);
  const tax = checkTaxId(input.taxId);
  if (!tax.ok) throw new HttpError(400, tax.error);
  const existing = await db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.sandboxId, sandboxId));
  if (existing.length >= LIMITS.clients) throw new HttpError(400, `W demo można mieć najwyżej ${LIMITS.clients} klientów.`);
  const same = existing.find((c) => c.name.toLocaleLowerCase("pl") === input.name.toLocaleLowerCase("pl"));
  if (same) throw new HttpError(409, `Klient „${same.name}” już jest na liście.`);
  const id = newId("cl");
  // Client and first contact together, or neither.
  await db.transaction(async (tx) => {
    await tx.insert(clients).values({ sandboxId, id, name: input.name, taxId: tax.normalized, emailDomain: domainOf(input.contact.email), isKey: input.isKey });
    await tx.insert(clientContacts).values({ sandboxId, id: newId("ct"), clientId: id, ...input.contact });
  });
  return id;
}

export async function updateClient(db: Executor, sandboxId: string, clientId: string, raw: z.input<typeof ClientUpdateSchema>) {
  const input = parse(ClientUpdateSchema, raw);
  await requireClient(db, sandboxId, clientId);
  if (input.name) {
    const others = await db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.sandboxId, sandboxId));
    const same = others.find((c) => c.id !== clientId && c.name.toLocaleLowerCase("pl") === input.name!.toLocaleLowerCase("pl"));
    if (same) throw new HttpError(409, `Klient „${same.name}” już jest na liście.`);
  }
  const values = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  if (Object.keys(values).length === 0) return;
  await db.update(clients).set(values).where(and(eq(clients.sandboxId, sandboxId), eq(clients.id, clientId)));
}

export async function addContact(db: Executor, sandboxId: string, clientId: string, raw: z.input<typeof ContactInputSchema>) {
  const input = parse(ContactInputSchema, raw);
  await requireClient(db, sandboxId, clientId);
  const own = await db.select({ email: clientContacts.email }).from(clientContacts).where(and(eq(clientContacts.sandboxId, sandboxId), eq(clientContacts.clientId, clientId)));
  if (own.length >= LIMITS.contactsPerClient) throw new HttpError(400, `Najwyżej ${LIMITS.contactsPerClient} osób kontaktowych na klienta.`);
  if (own.some((c) => c.email.toLowerCase() === input.email.toLowerCase())) throw new HttpError(409, "Ta osoba (e-mail) już jest na liście.");
  const id = newId("ct");
  await db.insert(clientContacts).values({ sandboxId, id, clientId, ...input });
  return id;
}

export async function createPoint(db: Executor, sandboxId: string, clientId: string, raw: z.input<typeof PointInputSchema>) {
  const input = parse(PointInputSchema, raw);
  await requireClient(db, sandboxId, clientId);
  const manual = await db.select({ id: points.id }).from(points).where(and(eq(points.sandboxId, sandboxId), eq(points.source, "manual")));
  if (manual.length >= LIMITS.manualPoints) throw new HttpError(400, `W demo można dodać najwyżej ${LIMITS.manualPoints} punktów.`);
  const id = newId("pt");
  await db.insert(points).values({ sandboxId, id, clientId, kind: "client", source: "manual", ...input });
  // Routes to and from the new point are approximated from its coordinates from now on.
  registerPointCoords([{ id, lng: input.lng, lat: input.lat }]);
  return id;
}

async function requireOwnPoint(db: Executor, sandboxId: string, pointId: string) {
  const [point] = await db.select().from(points).where(and(eq(points.sandboxId, sandboxId), eq(points.id, pointId)));
  if (!point || !point.clientId) throw new HttpError(404, "Nie ma takiego punktu klienta.");
  return point;
}

export async function updatePoint(db: Executor, sandboxId: string, pointId: string, raw: z.input<typeof PointUpdateSchema>) {
  const input = parse(PointUpdateSchema, raw);
  await requireOwnPoint(db, sandboxId, pointId);
  const values = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  if (Object.keys(values).length === 0) return;
  await db.update(points).set(values).where(and(eq(points.sandboxId, sandboxId), eq(points.id, pointId)));
}

/** Only points added in the app, and only while no order or standing-order template uses them. */
export async function deletePoint(db: Executor, sandboxId: string, pointId: string) {
  const point = await requireOwnPoint(db, sandboxId, pointId);
  if (point.source !== "manual") throw new HttpError(409, "Punktów ze scenariusza demo nie usuwamy.");
  const [usedByOrder] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.sandboxId, sandboxId), or(eq(orders.pickupPointId, pointId), eq(orders.deliveryPointId, pointId))))
    .limit(1);
  const [usedByTemplate] = await db
    .select({ id: orderTemplates.id })
    .from(orderTemplates)
    .where(and(eq(orderTemplates.sandboxId, sandboxId), eq(orderTemplates.archived, false), or(eq(orderTemplates.pickupPointId, pointId), eq(orderTemplates.deliveryPointId, pointId))))
    .limit(1);
  if (usedByOrder || usedByTemplate) throw new HttpError(409, "Punkt jest używany w zleceniach albo szablonach — nie można go usunąć.");
  await db.delete(points).where(and(eq(points.sandboxId, sandboxId), eq(points.id, pointId)));
}

export type ClientOverview = {
  id: string;
  name: string;
  taxId: string;
  isKey: boolean;
  manual: boolean;
  contacts: { id: string; name: string; email: string; phone: string }[];
  points: {
    id: string;
    name: string;
    address: string;
    city: string;
    country: string;
    lat: number;
    lng: number;
    openingHours: string;
    requirements: string;
    notes: string;
    handlingMinutes: number;
    manual: boolean;
  }[];
  openOrders: number;
  closedOrders: number;
};

/** The client book: clients, their people and points, and how much work they bring. */
export async function clientsOverview(db: Executor, sandboxId: string): Promise<ClientOverview[]> {
  const [clientRows, contactRows, pointRows, openRows, closedRows] = await Promise.all([
    db.select().from(clients).where(eq(clients.sandboxId, sandboxId)),
    db.select().from(clientContacts).where(eq(clientContacts.sandboxId, sandboxId)),
    db.select().from(points).where(eq(points.sandboxId, sandboxId)),
    db.select({ clientId: orders.clientId }).from(orders).where(and(eq(orders.sandboxId, sandboxId), notInArray(orders.status, ["ZAMKNIETE", "ANULOWANE", "SZKIC"]))),
    db.select({ clientId: orders.clientId }).from(orders).where(and(eq(orders.sandboxId, sandboxId), inArray(orders.status, ["ZAMKNIETE"]))),
  ]);
  registerPointCoords(pointRows);
  const count = (rows: { clientId: string }[], id: string) => rows.filter((r) => r.clientId === id).length;
  return clientRows
    .map((c) => ({
      id: c.id,
      name: c.name,
      taxId: c.taxId,
      isKey: c.isKey,
      manual: c.id.startsWith("cl-x-"),
      contacts: contactRows.filter((k) => k.clientId === c.id).map((k) => ({ id: k.id, name: k.name, email: k.email, phone: k.phone })),
      points: pointRows
        .filter((p) => p.clientId === c.id)
        .map((p) => ({
          id: p.id,
          name: p.name,
          address: p.address,
          city: p.city,
          country: p.country,
          lat: p.lat,
          lng: p.lng,
          openingHours: p.openingHours,
          requirements: p.requirements,
          notes: p.notes,
          handlingMinutes: p.handlingMinutes,
          manual: p.source === "manual",
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "pl")),
      openOrders: count(openRows, c.id),
      closedOrders: count(closedRows, c.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pl"));
}
