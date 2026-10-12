/**
 * Drizzle schema. Mirrors db/schema.sql — keep the two in sync (see CLAUDE.md).
 *
 * Auth tables (users/sessions/accounts/verifications) are shaped for Better Auth.
 * Local passwords live in `accounts.password` (Argon2id), not on `users`.
 */
import { sql } from "drizzle-orm";
import type { RunbookStep } from "@/server/kb/runbook";
import { DEFAULT_MAC_FORMAT, MAC_FORMATS } from "@/lib/net/mac";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const now = sql`now()`;

/** Postgres tsvector — Drizzle has no built-in for it. */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

/* ---------- Identity ---------- */

/**
 * What a role may do. The three the product started with are rows like any
 * other, marked built in: their powers are the product's word and the rows
 * cannot be changed or archived. A role an administrator makes carries any
 * subset of the permissions in src/server/auth/permissions.ts.
 */
export const roles = pgTable("roles", {
  /** The value users.role holds: "admin", "tech", "readonly", or a slug the operator chose. */
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  permissions: text("permissions")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  builtin: boolean("builtin").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(now),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    role: text("role")
      .notNull()
      .default("tech")
      .references(() => roles.key),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    canRevealSecrets: boolean("can_reveal_secrets").notNull().default(false),
    /** False means the user sees only what user_companies grants them. */
    allCompanies: boolean("all_companies").notNull().default(false),
    /** Set by an administrator's temporary password; cleared when the user chooses their own. */
    mustChangePassword: boolean("must_change_password")
      .notNull()
      .default(false),
    /** Wrong passwords in a row, and until when the account is closed to sign-in. */
    failedSignIns: integer("failed_sign_ins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    /** When an administrator must have enrolled a second factor by. Null for others. */
    mfaDeadline: timestamp("mfa_deadline", { withTimezone: true }),
    /** Wrong codes in a row, and until when the second step is closed. */
    mfaFailures: integer("mfa_failures").notNull().default(0),
    mfaLockedUntil: timestamp("mfa_locked_until", { withTimezone: true }),
    /** How a revealed secret is shown to them; see src/lib/secret-style.ts. */
    secretStyle: text("secret_style").notNull().default("on"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(now),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(now),
  },
  (t) => [
    check(
      "users_secret_style_check",
      sql`${t.secretStyle} IN ('on','colorblind','off')`,
    ),
  ],
);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  /** When this session last passed the second step. Null until it has. */
  mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(now),
});

/* ---------- Second factors ---------- */

/**
 * An authenticator app. The seed is encrypted with a key derived from the
 * instance secret, never stored as it is; the last step that was accepted is
 * kept so a code cannot be used twice.
 */
export const mfaTotp = pgTable("mfa_totp", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  secretEncrypted: text("secret_encrypted").notNull(),
  lastUsedStep: bigint("last_used_step", { mode: "number" }),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true })
    .notNull()
    .default(now),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

/** A passkey: a security key or a platform credential, named by its owner. */
export const mfaPasskeys = pgTable(
  "mfa_passkeys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    credentialId: text("credential_id").notNull().unique(),
    publicKey: text("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports").notNull().default(""),
    deviceType: text("device_type").notNull().default("singleDevice"),
    backedUp: boolean("backed_up").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(now),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [index("mfa_passkeys_user_idx").on(t.userId)],
);

/** Single-use codes for when the other factors are out of reach. Hashed; shown once. */
export const mfaRecoveryCodes = pgTable(
  "mfa_recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(now),
  },
  (t) => [index("mfa_recovery_codes_user_idx").on(t.userId)],
);

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  password: text("password"), // Argon2id hash, credential provider only
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(now),
});

export const verifications = pgTable("verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(now),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(now),
});

/* ---------- Hierarchy ---------- */

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    isInternal: boolean("is_internal").notNull().default(false),
    notes: text("notes"), // markdown
    brandScheme: text("brand_scheme").notNull().default("light"),
    /** Which vault this client's secrets live in. Null means the default one. */
    vaultProviderId: uuid("vault_provider_id"),
    accent: text("accent"), // #rrggbb, validated in app code
    altAccent: text("alt_accent"),
    logoKey: text("logo_key"),
    logoMime: text("logo_mime"),
    altLogoKey: text("alt_logo_key"),
    altLogoMime: text("alt_logo_mime"),
    /**
     * How often this company's domain records are re-checked, kind by kind,
     * and how far ahead a certificate is worth a warning. Null follows the
     * instance; zero turns a kind off for the company. See src/server/domain/policy.ts.
     */
    domainDnsIntervalDays: integer("domain_dns_interval_days"),
    domainTlsIntervalDays: integer("domain_tls_interval_days"),
    domainRdapIntervalDays: integer("domain_rdap_interval_days"),
    domainEmailIntervalDays: integer("domain_email_interval_days"),
    domainBrandIntervalDays: integer("domain_brand_interval_days"),
    domainTlsWarnDays: integer("domain_tls_warn_days"),
    /** The domain record whose website branding was last applied as this company's theme. */
    brandDomainDocumentId: uuid("brand_domain_document_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(now),
  },
  (t) => [
    check(
      "companies_domain_intervals_check",
      sql`(${t.domainDnsIntervalDays} IS NULL OR ${t.domainDnsIntervalDays} BETWEEN 0 AND 365)
      AND (${t.domainTlsIntervalDays} IS NULL OR ${t.domainTlsIntervalDays} BETWEEN 0 AND 365)
      AND (${t.domainRdapIntervalDays} IS NULL OR ${t.domainRdapIntervalDays} BETWEEN 0 AND 365)
      AND (${t.domainEmailIntervalDays} IS NULL OR ${t.domainEmailIntervalDays} BETWEEN 0 AND 365)
      AND (${t.domainBrandIntervalDays} IS NULL OR ${t.domainBrandIntervalDays} BETWEEN 0 AND 365)
      AND (${t.domainTlsWarnDays} IS NULL OR ${t.domainTlsWarnDays} BETWEEN 1 AND 365)`,
    ),
  ],
);

/**
 * Instance branding: one row, held to one row by a boolean primary key that
 * may only be true. A logo is a storage key, never an uploaded filename.
 */
export const instanceBranding = pgTable(
  "instance_branding",
  {
    id: boolean("id").primaryKey().default(true),
    name: text("name"),
    /** Which mode the primary logo and accent were drawn for. */
    scheme: text("scheme").notNull().default("light"),
    /** The "Powered by" credit. On unless an operator turns it off. */
    showPoweredBy: boolean("show_powered_by").notNull().default(true),
    /**
     * On the public knowledge base the credit may carry the operator's own
     * name and logo in place of the vendor's: "Powered by Trove KB | <name>".
     * Null keeps the vendor's credit there too.
     */
    kbPoweredByName: text("kb_powered_by_name"),
    accent: text("accent"),
    /** An exact color for the other mode. Derived from `accent` when null. */
    altAccent: text("alt_accent"),
    /** Text on the accent, per mode. Null means black or white, whichever reads. */
    accentText: text("accent_text"),
    altAccentText: text("alt_accent_text"),
    logoKey: text("logo_key"),
    logoMime: text("logo_mime"),
    altLogoKey: text("alt_logo_key"),
    altLogoMime: text("alt_logo_mime"),
    /** An operator's own tab icon, per mode; without one the mark stands. */
    iconKey: text("icon_key"),
    iconMime: text("icon_mime"),
    altIconKey: text("alt_icon_key"),
    altIconMime: text("alt_icon_mime"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    check("instance_branding_singleton", sql`${t.id}`),
    check(
      "instance_branding_scheme_check",
      sql`${t.scheme} IN ('light','dark')`,
    ),
  ],
);

export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  address: text("address"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/* ---------- Templates (doc types) ---------- */

export const docTypes = pgTable(
  "doc_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    icon: text("icon"),
    /** Documents of this type carry a rack elevation. */
    isRack: boolean("is_rack").notNull().default(false),
    /*
     * A review schedule every document of this type starts life with. A doc
     * type cannot know an absolute date, so the first one is counted from the
     * day the document is created.
     */
    scheduleKind: text("schedule_kind"),
    scheduleDueDays: integer("schedule_due_days"),
    scheduleIntervalDays: integer("schedule_interval_days"),
    scheduleLeadDays: integer("schedule_lead_days"),
    scope: text("scope").notNull().default("location"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    check("doc_types_scope_check", sql`${t.scope} IN ('company','location')`),
    check(
      "doc_types_schedule_kind_check",
      sql`${t.scheduleKind} IS NULL OR ${t.scheduleKind} IN ('expiry','maintenance')`,
    ),
    check(
      "doc_types_schedule_days_check",
      sql`(${t.scheduleDueDays} IS NULL OR ${t.scheduleDueDays} BETWEEN 1 AND 3650)
        AND (${t.scheduleIntervalDays} IS NULL OR ${t.scheduleIntervalDays} BETWEEN 1 AND 3650)
        AND (${t.scheduleLeadDays} IS NULL OR ${t.scheduleLeadDays} BETWEEN 0 AND 365)`,
    ),
  ],
);

export const optionLists = pgTable("option_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
});

export const optionItems = pgTable(
  "option_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => optionLists.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }), // hide, never hard delete
  },
  (t) => [unique("option_items_list_id_label_key").on(t.listId, t.label)],
);

/* ---------- Documents ---------- */

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    docTypeId: uuid("doc_type_id")
      .notNull()
      .references(() => docTypes.id),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => locations.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    /** { "<field_id>": value } — keyed by field UUID, never by label. */
    fieldValues: jsonb("field_values")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Optional per-doc order override: ["<field_id>", ...] */
    fieldOrder: jsonb("field_order").$type<string[] | null>(),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(now),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Maintained by the app on save: flattened text of field_values. */
    searchText: text("search_text").notNull().default(""),
    searchVec: tsvector("search_vec").generatedAlwaysAs(
      sql`to_tsvector('english', title || ' ' || search_text)`,
    ),
  },
  (t) => [
    index("documents_values_gin").using("gin", t.fieldValues),
    index("documents_search_idx").using("gin", t.searchVec),
  ],
);

/* ---------- Fields ---------- */

/** The MAC formats a CHECK allows, as a SQL list. */
const MAC_FORMAT_SQL = sql.raw(MAC_FORMATS.map((format) => `'${format}'`).join(","));

export const FIELD_TYPES = [
  "text",
  "markdown",
  "richtext",
  "number",
  "date",
  "url",
  "ip",
  "ip_list",
  "network",
  "ip_range",
  "mac",
  "vlan",
  "hostname",
  "port",
  "port_range",
  "boolean",
  "dropdown",
  "multi_dropdown",
  "doc_link",
  "secret_ref",
] as const;

/**
 * One table for template fields AND doc-local fields.
 * "Add to template" = set doc_type_id, clear document_id. That is the whole promote operation.
 */
export const fields = pgTable(
  "fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    docTypeId: uuid("doc_type_id").references(() => docTypes.id, {
      onDelete: "cascade",
    }),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "cascade",
    }),
    label: text("label").notNull(),
    fieldType: text("field_type").notNull(),
    optionListId: uuid("option_list_id").references(() => optionLists.id),
    linkDocTypeId: uuid("link_doc_type_id").references(
      (): typeof docTypes.id => docTypes.id,
    ),
    required: boolean("required").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * What this field means to a domain check: which field holds the domain,
     * and which ones a lookup can offer to fill in. Null for ordinary fields,
     * which is nearly all of them.
     */
    domainRole: text("domain_role"),
    /**
     * mac only: how this field writes an address. Null follows the instance
     * setting (instance_settings.mac_format).
     */
    macFormat: text("mac_format"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "fields_mac_format_check",
      sql`${t.macFormat} IS NULL OR ${t.macFormat} IN (${MAC_FORMAT_SQL})`,
    ),
    check(
      "fields_domain_role_check",
      sql`${t.domainRole} IS NULL OR ${t.domainRole} IN ('domain','expiry','registrar','dns_host')`,
    ),
    check(
      "fields_field_type_check",
      sql`${t.fieldType} IN ('text','markdown','richtext','number','date','url','ip','ip_list','network','ip_range','mac','vlan','hostname','port','port_range','boolean','dropdown','multi_dropdown','doc_link','secret_ref')`,
    ),
    check(
      "fields_owner_check",
      sql`(${t.docTypeId} IS NULL) <> (${t.documentId} IS NULL)`,
    ),
  ],
);

/* ---------- History, links, files ---------- */

export const documentRevisions = pgTable("document_revisions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  fieldValues: jsonb("field_values").$type<Record<string, unknown>>().notNull(),
  editedBy: uuid("edited_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(now),
});

/** Derived from doc_link fields, for backlinks. */
export const documentLinks = pgTable(
  "document_links",
  {
    fromDoc: uuid("from_doc")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    toDoc: uuid("to_doc")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => fields.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.fromDoc, t.toDoc, t.fieldId] })],
);

export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  storageKey: text("storage_key").notNull(), // local volume or S3 path
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(now),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id").references(() => users.id),
  action: text("action").notNull(), // document.update, field.promote, option.add
  entity: text("entity").notNull(),
  entityId: uuid("entity_id"),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(now),
});

/* ---------- Integrations ---------- */

/** Maps our records to IDs in any external system (PSA, RMM, CRM). */
export const externalRefs = pgTable(
  "external_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    system: text("system").notNull(), // 'halopsa', 'syncro', 'resolvd', free text
    externalId: text("external_id").notNull(),
  },
  (t) => [
    check(
      "external_refs_entity_check",
      sql`${t.entity} IN ('company','location','document')`,
    ),
    unique("external_refs_system_entity_external_id_key").on(
      t.system,
      t.entity,
      t.externalId,
    ),
    index("external_refs_entity_idx").on(t.entity, t.entityId),
  ],
);

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(), // "HaloPSA integration"
  prefix: text("prefix").notNull().unique(), // first 8 chars, shown in UI
  keyHash: text("key_hash").notNull(), // sha256 of full key; full key shown once
  scopes: text("scopes")
    .array()
    .notNull()
    .default(sql`'{read}'`),
  createdBy: uuid("created_by").references(() => users.id),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  /** False means the key sees only what api_key_companies grants it. */
  allCompanies: boolean("all_companies").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(now),
});

/**
 * Per-document domain checks: which lookups this record runs, and what the
 * last run found. One row per document, created when somebody first turns a
 * check on.
 */
export const domainChecks = pgTable(
  "domain_checks",
  {
    documentId: uuid("document_id")
      .primaryKey()
      .references(() => documents.id, { onDelete: "cascade" }),
    dns: boolean("dns").notNull().default(false),
    tls: boolean("tls").notNull().default(false),
    rdap: boolean("rdap").notNull().default(false),
    email: boolean("email").notNull().default(false),
    /** The website's own branding: icons and colors offered to the company's theme. */
    brand: boolean("brand").notNull().default(false),
    /** The last result, as rendered. Never anything secret: these are public records. */
    result: jsonb("result"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    /** Null when the worker ran it rather than a person. */
    checkedBy: uuid("checked_by").references(() => users.id),
    /** Whether the worker runs the chosen checks on its own. */
    auto: boolean("auto").notNull().default(true),
    /** How often each kind runs, for this record. Null follows the company, then the instance. */
    dnsIntervalDays: integer("dns_interval_days"),
    tlsIntervalDays: integer("tls_interval_days"),
    rdapIntervalDays: integer("rdap_interval_days"),
    emailIntervalDays: integer("email_interval_days"),
    brandIntervalDays: integer("brand_interval_days"),
    /** Each kind's own clock; next_run_at is the soonest of them, for the worker's query. */
    dnsNextRunAt: timestamp("dns_next_run_at", { withTimezone: true }),
    tlsNextRunAt: timestamp("tls_next_run_at", { withTimezone: true }),
    rdapNextRunAt: timestamp("rdap_next_run_at", { withTimezone: true }),
    emailNextRunAt: timestamp("email_next_run_at", { withTimezone: true }),
    brandNextRunAt: timestamp("brand_next_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    /**
     * The certificate renews on its own (ACME, a managed host), so its expiry
     * is no cause for alarm. A notice set alongside means "warn me anyway".
     */
    tlsAutoRenews: boolean("tls_auto_renews").notNull().default(false),
    /** Days ahead of certificate expiry to warn, for this record. Null follows the policy. */
    tlsWarnDays: integer("tls_warn_days"),
    /**
     * DKIM selectors to try for this domain, on top of the common ones. A
     * selector cannot be listed from DNS, so without this a domain signing
     * under its own name reads as having no key.
     */
    dkimSelectors: text("dkim_selectors"),
    /**
     * The last result boiled down to what is worth comparing — name servers,
     * certificate, registrar, expiry dates, mail posture — so the next run can
     * say what changed. See src/server/domain/summary.ts.
     */
    summary: jsonb("summary"),
    /** Expiry dates already announced, by kind, so each is announced once. */
    warned: jsonb("warned"),
    /** Why the last automatic run could not check anything, if it could not. */
    autoError: text("auto_error"),
  },
  (t) => [
    check(
      "domain_checks_intervals_check",
      sql`(${t.dnsIntervalDays} IS NULL OR ${t.dnsIntervalDays} BETWEEN 1 AND 365)
        AND (${t.tlsIntervalDays} IS NULL OR ${t.tlsIntervalDays} BETWEEN 1 AND 365)
        AND (${t.rdapIntervalDays} IS NULL OR ${t.rdapIntervalDays} BETWEEN 1 AND 365)
        AND (${t.emailIntervalDays} IS NULL OR ${t.emailIntervalDays} BETWEEN 1 AND 365)
        AND (${t.brandIntervalDays} IS NULL OR ${t.brandIntervalDays} BETWEEN 1 AND 365)
        AND (${t.tlsWarnDays} IS NULL OR ${t.tlsWarnDays} BETWEEN 1 AND 365)`,
    ),
    index("domain_checks_next_run_idx").on(t.nextRunAt),
  ],
);

/**
 * Instance settings: one row, like branding. What an operator chooses once for
 * the whole installation and would otherwise have to set in the environment.
 */
export const instanceSettings = pgTable(
  "instance_settings",
  {
    id: boolean("id").primaryKey().default(true),
    /** Overrides APP_LOCALE. Null means whatever the environment says. */
    defaultLocale: text("default_locale"),
    /**
     * The public knowledge base: off, open to the addresses listed, or open to
     * anyone who can reach it.
     */
    kbPublicMode: text("kb_public_mode").notNull().default("off"),
    /** Addresses and ranges, one per line, that count as on site. */
    kbPublicAddresses: text("kb_public_addresses").notNull().default(""),
    /** Where the public site is published, for the links the interface shows. */
    kbPublicUrl: text("kb_public_url"),
    /**
     * Cloudflare Access in front of the public site, when there is one: the
     * team's domain and the application's audience tag. With both set, a
     * visitor's Access token names them, and they can keep favorites and vote.
     */
    kbPublicAccessTeam: text("kb_public_access_team"),
    kbPublicAccessAud: text("kb_public_access_aud"),
    /**
     * How often the worker re-runs each kind of domain check, in days, unless
     * a company or record says otherwise. Zero turns that kind off everywhere.
     * The defaults are DEFAULT_INTERVALS in src/server/domain/policy.ts.
     */
    domainDnsIntervalDays: integer("domain_dns_interval_days")
      .notNull()
      .default(1),
    domainTlsIntervalDays: integer("domain_tls_interval_days")
      .notNull()
      .default(1),
    domainRdapIntervalDays: integer("domain_rdap_interval_days")
      .notNull()
      .default(7),
    domainEmailIntervalDays: integer("domain_email_interval_days")
      .notNull()
      .default(7),
    domainBrandIntervalDays: integer("domain_brand_interval_days")
      .notNull()
      .default(7),
    /** Days ahead of a certificate's expiry to warn, unless a company or record says otherwise. */
    domainTlsWarnDays: integer("domain_tls_warn_days").notNull().default(30),
    /** How MAC address fields write an address unless the field says otherwise. */
    macFormat: text("mac_format").notNull().default(DEFAULT_MAC_FORMAT),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(now),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    check("instance_settings_singleton", sql`${t.id}`),
    check(
      "instance_settings_mac_format_check",
      sql`${t.macFormat} IN (${MAC_FORMAT_SQL})`,
    ),
    check(
      "instance_settings_kb_public_mode_check",
      sql`${t.kbPublicMode} IN ('off','addresses','open')`,
    ),
    check(
      "instance_settings_domain_intervals_check",
      sql`${t.domainDnsIntervalDays} BETWEEN 0 AND 365
        AND ${t.domainTlsIntervalDays} BETWEEN 0 AND 365
        AND ${t.domainRdapIntervalDays} BETWEEN 0 AND 365
        AND ${t.domainEmailIntervalDays} BETWEEN 0 AND 365
        AND ${t.domainBrandIntervalDays} BETWEEN 0 AND 365
        AND ${t.domainTlsWarnDays} BETWEEN 1 AND 365`,
    ),
  ],
);

/**
 * When a document needs looking at again: a certificate that expires, a UPS
 * battery due for a swap, a contract up for renewal. One row per document,
 * either a date that arrives once or a job that comes round again.
 */
export const documentSchedules = pgTable(
  "document_schedules",
  {
    documentId: uuid("document_id")
      .primaryKey()
      .references(() => documents.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** The next date this matters. */
    dueOn: date("due_on").notNull(),
    /** Maintenance only: how often it comes round. */
    intervalDays: integer("interval_days"),
    /** How long before the date it starts asking for attention. */
    leadDays: integer("lead_days").notNull().default(30),
    lastDoneOn: date("last_done_on"),
    note: text("note"),
    /** The due date an event was last sent for, so nothing is announced twice. */
    notifiedFor: date("notified_for"),
    /** True until somebody edits it: this came from the doc type, not a person. */
    fromDocType: boolean("from_doc_type").notNull().default(false),
  },
  (t) => [
    check(
      "document_schedules_kind_check",
      sql`${t.kind} IN ('expiry','maintenance')`,
    ),
    check(
      "document_schedules_lead_check",
      sql`${t.leadDays} BETWEEN 0 AND 365`,
    ),
    check(
      "document_schedules_interval_check",
      sql`${t.intervalDays} IS NULL OR ${t.intervalDays} BETWEEN 1 AND 3650`,
    ),
    index("document_schedules_due_idx").on(t.dueOn),
  ],
);

/* ---------- Racks ---------- */

/**
 * A rack is an ordinary document with an elevation attached: how many units
 * it has, whether the back is used, and which way its rails are numbered.
 * Racks are labelled from the bottom in most rooms and from the top in some,
 * so each rack says which it is rather than the software deciding.
 */
export const racks = pgTable(
  "racks",
  {
    documentId: uuid("document_id")
      .primaryKey()
      .references(() => documents.id, { onDelete: "cascade" }),
    totalU: integer("total_u").notNull().default(42),
    hasRear: boolean("has_rear").notNull().default(false),
    numbering: text("numbering").notNull().default("bottom_up"),
  },
  (t) => [
    check("racks_total_u_check", sql`${t.totalU} BETWEEN 1 AND 60`),
    check(
      "racks_numbering_check",
      sql`${t.numbering} IN ('bottom_up','top_down')`,
    ),
  ],
);

/**
 * One thing in a rack. It is either a document that is already written up, or
 * a label for something nobody will ever document — a patch panel, a shelf —
 * which still has to appear on the elevation.
 */
export const rackMounts = pgTable(
  "rack_mounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rackId: uuid("rack_id")
      .notNull()
      .references(() => racks.documentId, { onDelete: "cascade" }),
    /** The lowest unit it occupies, in the numbers printed on the rails. */
    positionU: integer("position_u").notNull(),
    heightU: integer("height_u").notNull().default(1),
    face: text("face").notNull().default("front"),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    label: text("label"),
    /** What it is, when there is no document to take that from. */
    docTypeId: uuid("doc_type_id").references(() => docTypes.id),
  },
  (t) => [
    check("rack_mounts_height_check", sql`${t.heightU} BETWEEN 1 AND 20`),
    check("rack_mounts_face_check", sql`${t.face} IN ('front','rear','both')`),
    check(
      "rack_mounts_identity_check",
      sql`${t.documentId} IS NOT NULL OR ${t.label} IS NOT NULL`,
    ),
    index("rack_mounts_rack_idx").on(t.rackId),
  ],
);

/**
 * What color a kind of equipment is drawn in. A row with no company is the
 * MSP's default for everyone; a row with one is that client's override, which
 * the interface says so out loud.
 */
export const rackTypeColors = pgTable(
  "rack_type_colors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    docTypeId: uuid("doc_type_id")
      .notNull()
      .references(() => docTypes.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "cascade",
    }),
    color: text("color").notNull(),
  },
  (t) => [
    uniqueIndex("rack_type_colors_global_idx")
      .on(t.docTypeId)
      .where(sql`${t.companyId} IS NULL`),
    uniqueIndex("rack_type_colors_company_idx")
      .on(t.docTypeId, t.companyId)
      .where(sql`${t.companyId} IS NOT NULL`),
  ],
);

/* ---------- Per-company access ---------- */

export const userCompanies = pgTable(
  "user_companies",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .default(now),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.companyId] }),
    index("user_companies_company_idx").on(t.companyId),
  ],
);

export const apiKeyCompanies = pgTable(
  "api_key_companies",
  {
    apiKeyId: uuid("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .default(now),
  },
  (t) => [
    primaryKey({ columns: [t.apiKeyId, t.companyId] }),
    index("api_key_companies_company_idx").on(t.companyId),
  ],
);

export const webhooks = pgTable("webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull(),
  secret: text("secret").notNull(), // HMAC-SHA256 signing secret
  events: text("events").array().notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(now),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  webhookId: uuid("webhook_id")
    .notNull()
    .references(() => webhooks.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  statusCode: integer("status_code"),
  attempts: integer("attempts").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(now),
});

/* ---------- Vault integration ---------- */

/** Non-secret provider config. Credentials stay in env / Docker secrets. */
export const vaultProviders = pgTable(
  "vault_providers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(), // e.g. "Main Vaultwarden"
    kind: text("kind").notNull(),
    webVaultUrl: text("web_vault_url"), // for deep links
    organizationId: text("organization_id"),
    allowCreate: boolean("allow_create").notNull().default(false),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    status: text("status").notNull().default("unknown"), // ok | locked | unreachable
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => [
    check(
      "vault_providers_kind_check",
      sql`${t.kind} IN ('link','bw_serve','bitwarden_public_api','op_connect','hashicorp_kv','passbolt','keeper')`,
    ),
  ],
);

/* ---------- Knowledge base ---------- */

/**
 * A knowledge base collection: one per source, such as a vendor's published
 * KB. Collections sit beside the documentation rather than inside it — they
 * belong to no company, and nothing in them is a document.
 */
export const kbCollections = pgTable("kb_collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  /**
   * Where the source lives, for a reader who would rather go there: the
   * vendor's own site, which may hold what an export could not reach. Left
   * empty, a connector's address stands in.
   */
  siteUrl: text("site_url"),
  /**
   * True means anyone who can sign in may read it. False means only those
   * with access to one of the companies in kb_collection_companies.
   */
  allCompanies: boolean("all_companies").notNull().default(true),
  /** Whether the MCP tools may search and read this collection. */
  mcpEnabled: boolean("mcp_enabled").notNull().default(true),
  /**
   * Whether the public site shows this collection, to readers who have not
   * signed in. Off unless somebody turns it on, one collection at a time.
   */
  publicAccess: boolean("public_access").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(now),
});

/**
 * The email domains a company's own people sign in with. A visitor to the
 * public knowledge base named by Cloudflare Access is placed with a company
 * by the domain of their address, and then sees what that company's people
 * may: collections for every company, and those kept to theirs. A domain
 * names one company; a company may have several.
 */
export const companySignInDomains = pgTable(
  "company_sign_in_domains",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Lower case, no leading dot: "example.com". */
    domain: text("domain").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(now),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.domain] }),
    uniqueIndex("company_sign_in_domains_domain_idx").on(t.domain),
  ],
);

/** The companies a collection is kept to, when it is not for everyone. */
export const kbCollectionCompanies = pgTable(
  "kb_collection_companies",
  {
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => kbCollections.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.companyId] }),
    index("kb_collection_companies_company_idx").on(t.companyId),
  ],
);

/**
 * What an API key may do with one collection, beyond what its companies
 * already let it read. A grant that writes is how an application's own
 * tooling is allowed to keep its documentation current.
 */
export const apiKeyKbCollections = pgTable(
  "api_key_kb_collections",
  {
    apiKeyId: uuid("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => kbCollections.id, { onDelete: "cascade" }),
    /** Read by name, whatever companies the collection is kept to. False: only what the key's companies allow. */
    canRead: boolean("can_read").notNull().default(true),
    canWrite: boolean("can_write").notNull().default(false),
    /** The key may keep favorites and votes for a named reader here. On unless an admin turns it off. */
    reactions: boolean("reactions").notNull().default(true),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .default(now),
  },
  (t) => [
    primaryKey({ columns: [t.apiKeyId, t.collectionId] }),
    index("api_key_kb_collections_collection_idx").on(t.collectionId),
  ],
);

/**
 * A collection granted to a person by name, read or write, whatever
 * companies the collection is kept to. The same shape as a key's grant.
 */
export const userKbCollections = pgTable(
  "user_kb_collections",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => kbCollections.id, { onDelete: "cascade" }),
    canWrite: boolean("can_write").notNull().default(false),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .default(now),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.collectionId] }),
    index("user_kb_collections_collection_idx").on(t.collectionId),
  ],
);

export const kbArticles = pgTable(
  "kb_articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => kbCollections.id, { onDelete: "cascade" }),
    /**
     * What a re-import matches on: the source's own id when it has one, and
     * the file path when it does not, prefixed so the two can never collide.
     */
    sourceKey: text("source_key").notNull(),
    externalId: text("external_id"),
    sourcePath: text("source_path"),
    sourceUrl: text("source_url"),
    title: text("title").notNull(),
    /** Markdown, or plain text when `format` says so. */
    body: text("body").notNull().default(""),
    format: text("format").notNull().default("markdown"),
    /** What the file was: md, txt, pdf, docx, html. */
    sourceType: text("source_type").notNull(),
    category: text("category"),
    subcategory: text("subcategory"),
    /** Frontmatter the columns above do not cover, attachments included. */
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    dateCreated: timestamp("date_created", { withTimezone: true }),
    dateModified: timestamp("date_modified", { withTimezone: true }),
    /** `unextracted` is a file with no text layer: recorded, not searchable. */
    extraction: text("extraction").notNull().default("ok"),
    /** Kept off the public site even when its collection is on it. */
    publicHidden: boolean("public_hidden").notNull().default(false),
    /** Why: held back by hand, by a hide rule, or with its category. Null when shown. */
    hiddenBy: text("hidden_by"),
    /** An article, or a runbook: a procedure whose steps are kept apart for a consumer to track. */
    kind: text("kind").notNull().default("article"),
    /** A runbook's steps, derived from its body on every save; `[]` for an article. */
    steps: jsonb("steps").$type<RunbookStep[]>().notNull().default([]),
    /** SHA-256 of the source bytes, so an unchanged file is not rewritten. */
    contentHash: text("content_hash").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .default(now),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(now),
  },
  (t) => [
    unique("kb_articles_collection_source_key").on(t.collectionId, t.sourceKey),
    check("kb_articles_format_check", sql`${t.format} IN ('markdown','text')`),
    check(
      "kb_articles_extraction_check",
      sql`${t.extraction} IN ('ok','unextracted')`,
    ),
    check(
      "kb_articles_hidden_by_check",
      sql`${t.hiddenBy} IN ('manual','rule','category')`,
    ),
    check("kb_articles_kind_check", sql`${t.kind} IN ('article','runbook')`),
    index("kb_articles_runbook_idx")
      .on(t.collectionId)
      .where(sql`${t.kind} = 'runbook'`),
    index("kb_articles_category_idx").on(
      t.collectionId,
      t.category,
      t.subcategory,
    ),
  ],
);

/**
 * A pattern that holds articles back from the public site: by title, by the
 * name of their category or section, or by the file they came from. The
 * pattern is kept as typed; `regex` and `file_regex` are what is matched,
 * made on save: a literal escaped, a file pattern read as a glob.
 */
export const kbHideRules = pgTable(
  "kb_hide_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => kbCollections.id, { onDelete: "cascade" }),
    pattern: text("pattern").notNull(),
    isRegex: boolean("is_regex").notNull().default(false),
    matchArticles: boolean("match_articles").notNull().default(false),
    matchCategories: boolean("match_categories").notNull().default(false),
    matchFiles: boolean("match_files").notNull().default(false),
    regex: text("regex").notNull(),
    fileRegex: text("file_regex").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(now),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [index("kb_hide_rules_collection_idx").on(t.collectionId)],
);

/** A category held back from the public site with everything in it. Empty string is "uncategorized". */
export const kbHiddenCategories = pgTable(
  "kb_hidden_categories",
  {
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => kbCollections.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.category] })],
);

/**
 * An article cut into pieces small enough to rank and to quote. The title is
 * repeated on every chunk because a generated column can only see its own row.
 */
export const kbChunks = pgTable(
  "kb_chunks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    articleId: uuid("article_id")
      .notNull()
      .references(() => kbArticles.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => kbCollections.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    title: text("title").notNull(),
    /** The headings this chunk sits under, outermost first. */
    heading: text("heading").notNull().default(""),
    content: text("content").notNull(),
    searchVec: tsvector("search_vec").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', heading), 'B') || setweight(to_tsvector('english', content), 'D')`,
    ),
  },
  (t) => [
    unique("kb_chunks_article_ordinal").on(t.articleId, t.ordinal),
    index("kb_chunks_search_idx").using("gin", t.searchVec),
    index("kb_chunks_collection_idx").on(t.collectionId),
  ],
);

/**
 * A picture that came in with an import, kept under the path its articles
 * name it by. It belongs to the collection: an article reaches it by
 * referring to that path, and a reader reaches it through an article.
 */
export const kbImages = pgTable(
  "kb_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => kbCollections.id, { onDelete: "cascade" }),
    /** Where it sat in the import, which is how an article refers to it. */
    sourcePath: text("source_path").notNull(),
    storageKey: text("storage_key").notNull(),
    /** Decided from the bytes. A converted HEIC is stored, and served, as JPEG. */
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    /** SHA-256 of the file as it arrived, so an unchanged one is not rewritten. */
    contentHash: text("content_hash").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .default(now),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(now),
  },
  (t) => [
    unique("kb_images_collection_path").on(t.collectionId, t.sourcePath),
    // Exports disagree with themselves about case; the lookup forgives that.
    index("kb_images_lookup_idx").on(
      t.collectionId,
      sql`lower(${t.sourcePath})`,
    ),
  ],
);

/**
 * What a public reader keeps for themselves. The reader is known by a key
 * made from their identity and the instance secret, never by the identity
 * itself, so a dump of these rows names nobody.
 */
export const kbFavorites = pgTable(
  "kb_favorites",
  {
    readerKey: text("reader_key").notNull(),
    articleId: uuid("article_id")
      .notNull()
      .references(() => kbArticles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(now),
  },
  (t) => [
    primaryKey({ columns: [t.readerKey, t.articleId] }),
    index("kb_favorites_article_idx").on(t.articleId),
  ],
);

/** One vote per reader per article: helpful or not. Changing it replaces it. */
export const kbVotes = pgTable(
  "kb_votes",
  {
    readerKey: text("reader_key").notNull(),
    articleId: uuid("article_id")
      .notNull()
      .references(() => kbArticles.id, { onDelete: "cascade" }),
    helpful: boolean("helpful").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(now),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(now),
  },
  (t) => [
    primaryKey({ columns: [t.readerKey, t.articleId] }),
    index("kb_votes_article_idx").on(t.articleId),
  ],
);

/** One run of the importer, from an upload or from a connector. */
export const kbImports = pgTable(
  "kb_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => kbCollections.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    connectorId: uuid("connector_id"),
    filename: text("filename"),
    status: text("status").notNull().default("uploading"),
    /** Upload bookkeeping: what was promised, and how much has arrived. */
    expectedBytes: bigint("expected_bytes", { mode: "number" }),
    receivedBytes: bigint("received_bytes", { mode: "number" })
      .notNull()
      .default(0),
    total: integer("total").notNull().default(0),
    added: integer("added").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    /** Of those added or updated, how many had no text to extract. */
    unextracted: integer("unextracted").notNull().default(0),
    /** Files that are neither articles nor pictures: package notes, the manifest. */
    ignored: integer("ignored").notNull().default(0),
    /** Pictures in the archive that the collection now holds. */
    images: integer("images").notNull().default(0),
    /** A category given for the whole import, in place of the folder's name. */
    category: text("category"),
    /** [{ path, reason }], capped so one bad archive cannot fill the row. */
    failures: jsonb("failures")
      .$type<{ path: string; reason: string }[]>()
      .notNull()
      .default([]),
    usedManifest: boolean("used_manifest").notNull().default(false),
    error: text("error"),
    startedBy: uuid("started_by").references(() => users.id),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .default(now),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "kb_imports_source_check",
      sql`${t.source} IN ('upload','connector')`,
    ),
    check(
      "kb_imports_status_check",
      sql`${t.status} IN ('uploading','running','done','failed')`,
    ),
    index("kb_imports_collection_idx").on(t.collectionId, t.startedAt),
  ],
);

/**
 * A public KB fetched on a schedule: a sitemap, or every page under a URL
 * prefix. What it finds goes through the same upsert an upload does.
 */
export const kbConnectors = pgTable(
  "kb_connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => kbCollections.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    url: text("url").notNull(),
    intervalHours: integer("interval_hours").notNull().default(168),
    maxPages: integer("max_pages").notNull().default(500),
    enabled: boolean("enabled").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(now),
  },
  (t) => [
    check(
      "kb_connectors_kind_check",
      sql`${t.kind} IN ('sitemap','prefix','helpcenter')`,
    ),
    check(
      "kb_connectors_interval_check",
      sql`${t.intervalHours} BETWEEN 1 AND 8760`,
    ),
    check(
      "kb_connectors_max_pages_check",
      sql`${t.maxPages} BETWEEN 1 AND 20000`,
    ),
    index("kb_connectors_due_idx").on(t.nextRunAt),
  ],
);
