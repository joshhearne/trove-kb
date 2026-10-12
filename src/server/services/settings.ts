import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { instanceSettings } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import {
  DEFAULT_INTERVALS,
  DEFAULT_TLS_WARN_DAYS,
  INTERVAL_MAX_DAYS,
  type CheckPolicy,
} from "@/server/domain/policy";
import { z } from "zod";
import { isLocale, type Locale } from "@/i18n/locales";
import { parseAddressList } from "@/server/kb/addresses";
import {
  DEFAULT_MAC_FORMAT,
  MAC_FORMATS,
  isMacFormat,
  type MacFormat,
} from "@/lib/net/mac";

/**
 * Settings an operator chooses once for the whole installation. Today that is
 * the default language a new reader gets; the environment still supplies it
 * when nobody has chosen, so an install that never opens this screen behaves
 * exactly as it did.
 */

export async function getDefaultLocale(): Promise<Locale | null> {
  const [row] = await db
    .select({ defaultLocale: instanceSettings.defaultLocale })
    .from(instanceSettings)
    .where(eq(instanceSettings.id, true))
    .limit(1);

  return isLocale(row?.defaultLocale) ? row.defaultLocale : null;
}

export async function setDefaultLocale(
  locale: string | null,
  actorId: string,
): Promise<void> {
  const value = isLocale(locale) ? locale : null;

  await db.transaction(async (tx) => {
    await tx
      .insert(instanceSettings)
      .values({ id: true, defaultLocale: value, updatedBy: actorId })
      .onConflictDoUpdate({
        target: instanceSettings.id,
        set: {
          defaultLocale: value,
          updatedAt: new Date(),
          updatedBy: actorId,
        },
      });

    await writeAudit(
      {
        userId: actorId,
        action: "settings.updated",
        entity: "instance",
        entityId: null,
        detail: { defaultLocale: value },
      },
      tx,
    );
  });
}

/* ---------- Public knowledge base ---------- */

export const KB_PUBLIC_MODES = ["off", "addresses", "open"] as const;
export type KbPublicMode = (typeof KB_PUBLIC_MODES)[number];

export type KbPublicSettings = {
  mode: KbPublicMode;
  /** As typed, for the form. */
  addressText: string;
  /** What of it can be used. */
  addresses: string[];
  url: string | null;
  /** Cloudflare Access in front of the site, when both are set. */
  accessTeam: string | null;
  accessAud: string | null;
};

export const kbPublicInputSchema = z
  .object({
    mode: z.enum(KB_PUBLIC_MODES),
    addresses: z.string().max(10_000).default(""),
    url: z
      .string()
      .trim()
      .max(500)
      .refine((value) => {
        if (value === "") return true;
        try {
          const url = new URL(value);
          return url.protocol === "https:" || url.protocol === "http:";
        } catch {
          return false;
        }
      }, "Enter an http or https address")
      .default(""),
    /** The team's domain as Cloudflare names it: "example" for example.cloudflareaccess.com. */
    accessTeam: z
      .string()
      .trim()
      .toLowerCase()
      .max(100)
      .regex(
        /^[a-z0-9-]*$/,
        "The team name is the part before .cloudflareaccess.com",
      )
      .default(""),
    accessAud: z
      .string()
      .trim()
      .max(200)
      .regex(/^[a-f0-9]*$/i, "The audience tag is hexadecimal")
      .default(""),
  })
  .superRefine((input, ctx) => {
    if ((input.accessTeam === "") !== (input.accessAud === "")) {
      ctx.addIssue({
        code: "custom",
        path: [input.accessTeam === "" ? "accessTeam" : "accessAud"],
        message: "Set both the team and the audience tag, or neither",
      });
    }
    const list = parseAddressList(input.addresses);
    if (list.rejected.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["addresses"],
        message: `Not an address or a range: ${list.rejected.slice(0, 5).join(", ")}`,
      });
    }
    // Saying "these addresses" and naming none would be "off" by accident.
    if (input.mode === "addresses" && list.entries.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["addresses"],
        message: "List at least one address or range",
      });
    }
  });

export async function getKbPublicSettings(): Promise<KbPublicSettings> {
  const [row] = await db
    .select({
      mode: instanceSettings.kbPublicMode,
      addresses: instanceSettings.kbPublicAddresses,
      url: instanceSettings.kbPublicUrl,
      accessTeam: instanceSettings.kbPublicAccessTeam,
      accessAud: instanceSettings.kbPublicAccessAud,
    })
    .from(instanceSettings)
    .where(eq(instanceSettings.id, true))
    .limit(1);

  const mode = (KB_PUBLIC_MODES as readonly string[]).includes(row?.mode ?? "")
    ? (row?.mode as KbPublicMode)
    : "off";

  return {
    mode,
    addressText: row?.addresses ?? "",
    addresses: parseAddressList(row?.addresses ?? "").entries,
    url: row?.url ?? null,
    accessTeam: row?.accessTeam ?? null,
    accessAud: row?.accessAud ?? null,
  };
}

export async function setKbPublicSettings(
  input: z.input<typeof kbPublicInputSchema>,
  actorId: string,
): Promise<void> {
  const data = kbPublicInputSchema.parse(input);
  const values = {
    kbPublicMode: data.mode,
    kbPublicAddresses: data.addresses.trim(),
    kbPublicUrl: data.url === "" ? null : data.url.replace(/\/+$/, ""),
    kbPublicAccessTeam: data.accessTeam === "" ? null : data.accessTeam,
    kbPublicAccessAud: data.accessAud === "" ? null : data.accessAud,
  };

  await db.transaction(async (tx) => {
    await tx
      .insert(instanceSettings)
      .values({ id: true, ...values, updatedBy: actorId })
      .onConflictDoUpdate({
        target: instanceSettings.id,
        set: { ...values, updatedAt: new Date(), updatedBy: actorId },
      });

    await writeAudit(
      {
        userId: actorId,
        action: "settings.updated",
        entity: "instance",
        entityId: null,
        detail: {
          kbPublicMode: values.kbPublicMode,
          kbPublicAddresses: parseAddressList(values.kbPublicAddresses).entries,
          kbPublicUrl: values.kbPublicUrl,
          kbPublicAccessTeam: values.kbPublicAccessTeam,
        },
      },
      tx,
    );
  });
}

/* ---------- Automatic domain checks ---------- */

const intervalDays = z.coerce.number().int().min(0).max(INTERVAL_MAX_DAYS);

/** The instance layer of the policy: an interval per kind (zero is off) and the certificate notice. */
export const domainCheckPolicySchema = z.object({
  dns: intervalDays,
  tls: intervalDays,
  rdap: intervalDays,
  email: intervalDays,
  brand: intervalDays,
  tlsWarnDays: z.coerce.number().int().min(1).max(INTERVAL_MAX_DAYS),
});

export type DomainCheckPolicyInput = z.infer<typeof domainCheckPolicySchema>;

/** What every company and record follows unless it says otherwise. */
export async function getDomainCheckPolicy(): Promise<CheckPolicy> {
  const [row] = await db
    .select({
      dns: instanceSettings.domainDnsIntervalDays,
      tls: instanceSettings.domainTlsIntervalDays,
      rdap: instanceSettings.domainRdapIntervalDays,
      email: instanceSettings.domainEmailIntervalDays,
      brand: instanceSettings.domainBrandIntervalDays,
      tlsWarnDays: instanceSettings.domainTlsWarnDays,
    })
    .from(instanceSettings)
    .where(eq(instanceSettings.id, true))
    .limit(1);
  if (!row)
    return {
      intervals: { ...DEFAULT_INTERVALS },
      tlsWarnDays: DEFAULT_TLS_WARN_DAYS,
    };
  return {
    intervals: {
      dns: row.dns,
      tls: row.tls,
      rdap: row.rdap,
      email: row.email,
      brand: row.brand,
    },
    tlsWarnDays: row.tlsWarnDays,
  };
}

export async function setDomainCheckPolicy(
  input: unknown,
  actorId: string,
): Promise<void> {
  const value = domainCheckPolicySchema.parse(input);
  const set = {
    domainDnsIntervalDays: value.dns,
    domainTlsIntervalDays: value.tls,
    domainRdapIntervalDays: value.rdap,
    domainEmailIntervalDays: value.email,
    domainBrandIntervalDays: value.brand,
    domainTlsWarnDays: value.tlsWarnDays,
  };

  await db.transaction(async (tx) => {
    await tx
      .insert(instanceSettings)
      .values({ id: true, ...set, updatedBy: actorId })
      .onConflictDoUpdate({
        target: instanceSettings.id,
        set: { ...set, updatedAt: new Date(), updatedBy: actorId },
      });

    await writeAudit(
      {
        userId: actorId,
        action: "settings.updated",
        entity: "instance",
        entityId: null,
        detail: { domainChecks: value },
      },
      tx,
    );
  });
}

/** How MAC address fields write an address unless a field names its own format. */
export async function getMacFormat(): Promise<MacFormat> {
  const [row] = await db
    .select({ macFormat: instanceSettings.macFormat })
    .from(instanceSettings)
    .where(eq(instanceSettings.id, true))
    .limit(1);

  return isMacFormat(row?.macFormat) ? row.macFormat : DEFAULT_MAC_FORMAT;
}

export async function setMacFormat(format: string, actorId: string): Promise<void> {
  const value = z.enum(MAC_FORMATS).parse(format);

  await db.transaction(async (tx) => {
    await tx
      .insert(instanceSettings)
      .values({ id: true, macFormat: value, updatedBy: actorId })
      .onConflictDoUpdate({
        target: instanceSettings.id,
        set: { macFormat: value, updatedAt: new Date(), updatedBy: actorId },
      });

    await writeAudit(
      {
        userId: actorId,
        action: "settings.updated",
        entity: "instance",
        entityId: null,
        detail: { macFormat: value },
      },
      tx,
    );
  });
}
