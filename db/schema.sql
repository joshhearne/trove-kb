-- Trove KB data model (PostgreSQL 16+)
-- One instance = one MSP or internal IT team. Companies are clients (or yourself).
--
-- Reference model. src/server/db/schema.ts mirrors this file; the migrations in
-- drizzle/ are what actually run. Change both together.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Identity ----------
-- Better Auth owns users/sessions/accounts/verifications.
-- Local passwords live in accounts.password (Argon2id), never on users.
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text UNIQUE NOT NULL,
  name           text NOT NULL,
  role           text NOT NULL DEFAULT 'tech' CHECK (role IN ('admin','tech','readonly')),
  email_verified boolean NOT NULL DEFAULT false,
  image          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id    text NOT NULL,
  provider_id   text NOT NULL,          -- 'credential' for local accounts, else the OIDC provider
  password      text,                   -- Argon2id hash; null for OIDC-only accounts
  access_token  text,
  refresh_token text,
  id_token      text,
  access_token_expires_at  timestamptz,
  refresh_token_expires_at timestamptz,
  scope         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE verifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  value      text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Hierarchy ----------
CREATE TABLE companies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,  -- your own org
  notes       text,                            -- markdown
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,                   -- e.g. Head Office, Warehouse
  address     text,
  archived_at timestamptz
);

-- ---------- Templates (doc types) ----------
CREATE TABLE doc_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,            -- ISP, Firewall, Wi-Fi, Printer
  icon        text,
  scope       text NOT NULL DEFAULT 'location' CHECK (scope IN ('company','location')),
  archived_at timestamptz
);

-- Shared dropdown sources. The "+" button inserts into option_items.
CREATE TABLE option_lists (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE                    -- "ISP Vendors", "Firewall Models"
);

CREATE TABLE option_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id     uuid NOT NULL REFERENCES option_lists(id) ON DELETE CASCADE,
  label       text NOT NULL,
  sort_order  int  NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES users(id),
  archived_at timestamptz,                     -- hide, never hard delete
  UNIQUE (list_id, label)
);

-- ---------- Documents ----------
CREATE TABLE documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type_id uuid NOT NULL REFERENCES doc_types(id),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  title       text NOT NULL,
  field_values jsonb NOT NULL DEFAULT '{}',    -- { "<field_id>": value }
  field_order  jsonb,                          -- optional per-doc order override: ["<field_id>", ...]
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX documents_values_gin ON documents USING gin (field_values);

-- ---------- Fields ----------
-- One table for template fields AND doc-local fields.
-- "Add to template" = set doc_type_id, clear document_id. That's the whole promote operation.
CREATE TABLE fields (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type_id    uuid REFERENCES doc_types(id) ON DELETE CASCADE,
  document_id    uuid REFERENCES documents(id) ON DELETE CASCADE,
  label          text NOT NULL,
  field_type     text NOT NULL CHECK (field_type IN (
                   'text','markdown','richtext','number','date','url','ip',
                   'boolean','dropdown','multi_dropdown','doc_link','secret_ref')),
  option_list_id uuid REFERENCES option_lists(id),     -- dropdown types
  link_doc_type_id uuid REFERENCES doc_types(id),      -- doc_link: e.g. ISP -> Vendor doc
  required       boolean NOT NULL DEFAULT false,
  sort_order     int NOT NULL DEFAULT 0,
  archived_at    timestamptz,                  -- values stay in jsonb, just hidden
  CHECK ((doc_type_id IS NULL) <> (document_id IS NULL))
);

-- ---------- History, links, files ----------
CREATE TABLE document_revisions (
  id           bigserial PRIMARY KEY,
  document_id  uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  title        text NOT NULL,
  field_values jsonb NOT NULL,
  edited_by    uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document_links (               -- derived from doc_link fields, for backlinks
  from_doc uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  to_doc   uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  field_id uuid NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  PRIMARY KEY (from_doc, to_doc, field_id)
);

CREATE TABLE attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  filename    text NOT NULL,
  mime_type   text NOT NULL,
  storage_key text NOT NULL,                  -- local volume or S3 path
  size_bytes  bigint NOT NULL,
  uploaded_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES users(id),
  action     text NOT NULL,                   -- document.update, field.promote, option.add
  entity     text NOT NULL,
  entity_id  uuid,
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Search ----------
-- Maintained by the app on save: title + flattened text of field_values.
ALTER TABLE documents ADD COLUMN search_text text NOT NULL DEFAULT '';
ALTER TABLE documents ADD COLUMN search_vec tsvector
  GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || search_text)) STORED;
CREATE INDEX documents_search_idx ON documents USING gin (search_vec);

-- ---------- Integrations ----------
-- Maps our records to IDs in any external system (PSA, RMM, CRM).
-- Lets a ticket in HaloPSA, Syncro, ConnectWise, Resolvd, etc. find "its" company docs.
CREATE TABLE external_refs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity      text NOT NULL CHECK (entity IN ('company','location','document')),
  entity_id   uuid NOT NULL,
  system      text NOT NULL,                   -- 'halopsa', 'syncro', 'resolvd', free text
  external_id text NOT NULL,
  UNIQUE (system, entity, external_id)
);
CREATE INDEX external_refs_entity_idx ON external_refs (entity, entity_id);

CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,                  -- "HaloPSA integration"
  prefix       text NOT NULL UNIQUE,           -- first 8 chars, shown in UI
  key_hash     text NOT NULL,                  -- sha256 of full key; full key shown once
  scopes       text[] NOT NULL DEFAULT '{read}', -- read, write, admin
  created_by   uuid REFERENCES users(id),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhooks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url        text NOT NULL,
  secret     text NOT NULL,                    -- HMAC-SHA256 signing secret
  events     text[] NOT NULL,                  -- document.created, document.updated, ...
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
  id            bigserial PRIMARY KEY,
  webhook_id    uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event         text NOT NULL,
  payload       jsonb NOT NULL,
  status_code   int,
  attempts      int NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  delivered_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- Vault integration ----------
ALTER TABLE users ADD COLUMN can_reveal_secrets boolean NOT NULL DEFAULT false;

-- Non-secret provider config. Credentials stay in env / Docker secrets.
CREATE TABLE vault_providers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,                  -- e.g. "Main Vaultwarden"
  kind          text NOT NULL CHECK (kind IN ('link','bw_serve','bitwarden_public_api','op_connect','hashicorp_kv','passbolt','keeper')),
  web_vault_url text,                           -- for deep links
  organization_id text,                         -- Bitwarden org id
  allow_create  boolean NOT NULL DEFAULT false, -- create items from docs
  last_sync_at  timestamptz,
  status        text NOT NULL DEFAULT 'unknown',-- ok | locked | unreachable
  enabled       boolean NOT NULL DEFAULT true
);
-- Company <-> collection mapping uses external_refs (system = 'bitwarden').
-- secret_ref field values hold only item/collection ids and cached non-secret metadata.

-- ---------- Per-company access ----------
-- A principal (user or API key) either sees every company or only the ones
-- granted to it. New rows default to false: access is granted, never assumed.
ALTER TABLE users ADD COLUMN all_companies boolean NOT NULL DEFAULT false;
ALTER TABLE api_keys ADD COLUMN all_companies boolean NOT NULL DEFAULT false;

CREATE TABLE user_companies (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_id)
);
CREATE INDEX user_companies_company_idx ON user_companies (company_id);

CREATE TABLE api_key_companies (
  api_key_id uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, company_id)
);
CREATE INDEX api_key_companies_company_idx ON api_key_companies (company_id);
-- Admins are never restricted: they are who grants access in the first place.

-- ---------- Branding ----------
-- One row, ever: the boolean primary key can only be true.
CREATE TABLE instance_branding (
  id           boolean PRIMARY KEY DEFAULT true CHECK (id),
  name         text,                            -- replaces the wordmark
  accent       text,                            -- #rrggbb, validated in app code
  logo_key     text,                            -- storage key, never a filename
  logo_mime    text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES users(id)
);

ALTER TABLE companies ADD COLUMN accent    text;
ALTER TABLE companies ADD COLUMN logo_key  text;
ALTER TABLE companies ADD COLUMN logo_mime text;

-- ---------- Domain checks ----------
-- A field can declare what it means to a domain lookup, so the feature is not
-- wired to one doc type's labels.
ALTER TABLE fields ADD COLUMN domain_role text
  CHECK (domain_role IS NULL OR domain_role IN ('domain','expiry','registrar','dns_host'));

CREATE TABLE domain_checks (
  document_id uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  dns        boolean NOT NULL DEFAULT false,
  tls        boolean NOT NULL DEFAULT false,
  rdap       boolean NOT NULL DEFAULT false,
  email      boolean NOT NULL DEFAULT false,
  result     jsonb,                          -- last result, public data only
  checked_at timestamptz,
  checked_by uuid REFERENCES users(id)
);

-- ---------- Branding per theme ----------
-- A logo drawn for a light background disappears on a dark one, so branding
-- says which mode its assets were drawn for and may carry a set for the other.
ALTER TABLE instance_branding ADD COLUMN scheme text NOT NULL DEFAULT 'light'
  CHECK (scheme IN ('light','dark'));
ALTER TABLE instance_branding ADD COLUMN alt_accent text;
ALTER TABLE instance_branding ADD COLUMN alt_logo_key text;
ALTER TABLE instance_branding ADD COLUMN alt_logo_mime text;

ALTER TABLE companies ADD COLUMN brand_scheme text NOT NULL DEFAULT 'light'
  CHECK (brand_scheme IN ('light','dark'));
ALTER TABLE companies ADD COLUMN alt_accent text;
ALTER TABLE companies ADD COLUMN alt_logo_key text;
ALTER TABLE companies ADD COLUMN alt_logo_mime text;

-- ---------- A vault per company ----------
-- An MSP inherits whatever each client already uses, so a company may name its
-- own provider. Null means the instance default.
ALTER TABLE companies ADD COLUMN vault_provider_id uuid REFERENCES vault_providers(id);

-- Collection mappings are per provider: 'vault:<provider id>' rather than a
-- single 'bitwarden', so two vaults can both map the same company.

-- The "Powered by" credit is an operator's choice; the license notice and the
-- source link below it are not, since AGPL-3.0 §13 asks for them.
ALTER TABLE instance_branding ADD COLUMN show_powered_by boolean NOT NULL DEFAULT true;

-- ---------- Racks ----------
CREATE TABLE racks (
  document_id uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  total_u     int NOT NULL DEFAULT 42 CHECK (total_u BETWEEN 1 AND 60),
  has_rear    boolean NOT NULL DEFAULT false,
  -- Rails are numbered from the bottom in most rooms, the top in some.
  numbering   text NOT NULL DEFAULT 'bottom_up' CHECK (numbering IN ('bottom_up','top_down'))
);

CREATE TABLE rack_mounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rack_id     uuid NOT NULL REFERENCES racks(document_id) ON DELETE CASCADE,
  position_u  int NOT NULL,                       -- lowest unit, as the rails read
  height_u    int NOT NULL DEFAULT 1 CHECK (height_u BETWEEN 1 AND 20),
  face        text NOT NULL DEFAULT 'front' CHECK (face IN ('front','rear','both')),
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  label       text,                               -- for what is never documented
  doc_type_id uuid REFERENCES doc_types(id),      -- its kind, when there is no document
  CHECK (document_id IS NOT NULL OR label IS NOT NULL)
);
CREATE INDEX rack_mounts_rack_idx ON rack_mounts (rack_id);

-- A row with no company is the MSP default; with one, that client's override.
CREATE TABLE rack_type_colors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type_id uuid NOT NULL REFERENCES doc_types(id) ON DELETE CASCADE,
  company_id  uuid REFERENCES companies(id) ON DELETE CASCADE,
  color       text NOT NULL
);
CREATE UNIQUE INDEX rack_type_colors_global_idx ON rack_type_colors (doc_type_id)
  WHERE company_id IS NULL;
CREATE UNIQUE INDEX rack_type_colors_company_idx ON rack_type_colors (doc_type_id, company_id)
  WHERE company_id IS NOT NULL;

-- Documents of a rack doc type carry an elevation.
ALTER TABLE doc_types ADD COLUMN is_rack boolean NOT NULL DEFAULT false;

-- ---------- Instance settings ----------
-- One row. What an operator picks once, rather than setting in the environment.
CREATE TABLE instance_settings (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),
  default_locale text,                      -- overrides APP_LOCALE
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES users(id)
);

-- ---------- Schedules ----------
-- When a document needs looking at again: a date that arrives once, or a job
-- that comes round on an interval.
CREATE TABLE document_schedules (
  document_id   uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('expiry','maintenance')),
  due_on        date NOT NULL,
  interval_days int CHECK (interval_days IS NULL OR interval_days BETWEEN 1 AND 3650),
  lead_days     int NOT NULL DEFAULT 30 CHECK (lead_days BETWEEN 0 AND 365),
  last_done_on  date,
  note          text,
  notified_for  date                    -- the due date already announced
);
CREATE INDEX document_schedules_due_idx ON document_schedules (due_on);

-- ---------- Schedules from the doc type ----------
-- Every document of a type starts with the same review schedule. A doc type
-- cannot know an absolute date, so the first one counts from creation day.
ALTER TABLE doc_types ADD COLUMN schedule_kind text
  CHECK (schedule_kind IS NULL OR schedule_kind IN ('expiry','maintenance'));
ALTER TABLE doc_types ADD COLUMN schedule_due_days int
  CHECK (schedule_due_days IS NULL OR schedule_due_days BETWEEN 1 AND 3650);
ALTER TABLE doc_types ADD COLUMN schedule_interval_days int
  CHECK (schedule_interval_days IS NULL OR schedule_interval_days BETWEEN 1 AND 3650);
ALTER TABLE doc_types ADD COLUMN schedule_lead_days int
  CHECK (schedule_lead_days IS NULL OR schedule_lead_days BETWEEN 0 AND 365);

-- Whether a document's schedule is still the one its type stamped in.
ALTER TABLE document_schedules ADD COLUMN from_doc_type boolean NOT NULL DEFAULT false;

-- ---------- Knowledge base ----------
-- Collections sit beside the documentation: one per source, owned by no
-- company. Articles are upserted on (collection_id, source_key).
CREATE TABLE kb_collections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL UNIQUE,
  description        text,
  all_companies      boolean NOT NULL DEFAULT true,   -- false: kept to kb_collection_companies
  mcp_enabled        boolean NOT NULL DEFAULT true,
  archived_at        timestamptz,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- The companies a collection is kept to, when it is not for everyone.
CREATE TABLE kb_collection_companies (
  collection_id uuid NOT NULL REFERENCES kb_collections(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, company_id)
);
CREATE INDEX kb_collection_companies_company_idx ON kb_collection_companies (company_id);

-- What an API key may do with one collection, beyond what its companies let it read.
CREATE TABLE api_key_kb_collections (
  api_key_id    uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL REFERENCES kb_collections(id) ON DELETE CASCADE,
  can_write     boolean NOT NULL DEFAULT false,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, collection_id)
);
CREATE INDEX api_key_kb_collections_collection_idx ON api_key_kb_collections (collection_id);

CREATE TABLE kb_articles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES kb_collections(id) ON DELETE CASCADE,
  source_key    text NOT NULL,              -- 'id:<external_id>' or 'path:<file path>'
  external_id   text,
  source_path   text,
  source_url    text,
  title         text NOT NULL,
  body          text NOT NULL DEFAULT '',
  format        text NOT NULL DEFAULT 'markdown' CHECK (format IN ('markdown','text')),
  source_type   text NOT NULL,              -- md, txt, pdf, docx, html
  category      text,
  subcategory   text,
  metadata      jsonb NOT NULL DEFAULT '{}',
  date_created  timestamptz,
  date_modified timestamptz,
  extraction    text NOT NULL DEFAULT 'ok' CHECK (extraction IN ('ok','unextracted')),
  content_hash  text NOT NULL,
  archived_at   timestamptz,
  imported_at   timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection_id, source_key)
);
CREATE INDEX kb_articles_category_idx ON kb_articles (collection_id, category, subcategory);

CREATE TABLE kb_chunks (
  id            bigserial PRIMARY KEY,
  article_id    uuid NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL REFERENCES kb_collections(id) ON DELETE CASCADE,
  ordinal       int NOT NULL,
  title         text NOT NULL,              -- repeated: a generated column sees one row
  heading       text NOT NULL DEFAULT '',
  content       text NOT NULL,
  search_vec    tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', title), 'A') ||
    setweight(to_tsvector('english', heading), 'B') ||
    setweight(to_tsvector('english', content), 'D')
  ) STORED,
  UNIQUE (article_id, ordinal)
);
CREATE INDEX kb_chunks_search_idx ON kb_chunks USING gin (search_vec);
CREATE INDEX kb_chunks_collection_idx ON kb_chunks (collection_id);

CREATE TABLE kb_imports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id  uuid NOT NULL REFERENCES kb_collections(id) ON DELETE CASCADE,
  source         text NOT NULL CHECK (source IN ('upload','connector')),
  connector_id   uuid,
  filename       text,
  status         text NOT NULL DEFAULT 'uploading'
                 CHECK (status IN ('uploading','running','done','failed')),
  expected_bytes bigint,
  received_bytes bigint NOT NULL DEFAULT 0,
  total          int NOT NULL DEFAULT 0,
  added          int NOT NULL DEFAULT 0,
  updated        int NOT NULL DEFAULT 0,
  skipped        int NOT NULL DEFAULT 0,
  failed         int NOT NULL DEFAULT 0,
  unextracted    int NOT NULL DEFAULT 0,
  ignored        int NOT NULL DEFAULT 0,
  failures       jsonb NOT NULL DEFAULT '[]',
  used_manifest  boolean NOT NULL DEFAULT false,
  error          text,
  started_by     uuid REFERENCES users(id),
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz
);
CREATE INDEX kb_imports_collection_idx ON kb_imports (collection_id, started_at);

CREATE TABLE kb_connectors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id  uuid NOT NULL REFERENCES kb_collections(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('sitemap','prefix','helpcenter')),
  url            text NOT NULL,
  interval_hours int NOT NULL DEFAULT 168 CHECK (interval_hours BETWEEN 1 AND 8760),
  max_pages      int NOT NULL DEFAULT 500 CHECK (max_pages BETWEEN 1 AND 20000),
  enabled        boolean NOT NULL DEFAULT true,
  last_run_at    timestamptz,
  next_run_at    timestamptz,
  archived_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kb_connectors_due_idx ON kb_connectors (next_run_at);

-- ---------- Public knowledge base ----------
-- A collection shown to readers who have not signed in, and articles held
-- back from them. Who counts as a reader is an instance setting.
ALTER TABLE kb_collections ADD COLUMN public_access boolean NOT NULL DEFAULT false;
ALTER TABLE kb_articles ADD COLUMN public_hidden boolean NOT NULL DEFAULT false;
ALTER TABLE instance_settings ADD COLUMN kb_public_mode text NOT NULL DEFAULT 'off'
  CHECK (kb_public_mode IN ('off','addresses','open'));
ALTER TABLE instance_settings ADD COLUMN kb_public_addresses text NOT NULL DEFAULT '';
ALTER TABLE instance_settings ADD COLUMN kb_public_url text;

-- ---------- Knowledge base images ----------
-- Pictures that came in with an import, kept under the path the articles
-- name them by. Read only through an article that refers to them.
CREATE TABLE kb_images (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES kb_collections(id) ON DELETE CASCADE,
  source_path   text NOT NULL,
  storage_key   text NOT NULL,
  mime_type     text NOT NULL,
  size_bytes    bigint NOT NULL,
  content_hash  text NOT NULL,
  imported_at   timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection_id, source_path)
);
CREATE INDEX kb_images_lookup_idx ON kb_images (collection_id, lower(source_path));
ALTER TABLE kb_imports ADD COLUMN images int NOT NULL DEFAULT 0;

-- ---------- Public readers' favorites and votes ----------
-- A reader is known by a key made from their identity and the instance
-- secret, never by the identity itself.
ALTER TABLE instance_settings ADD COLUMN kb_public_access_team text;
ALTER TABLE instance_settings ADD COLUMN kb_public_access_aud text;

CREATE TABLE kb_favorites (
  reader_key text NOT NULL,
  article_id uuid NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reader_key, article_id)
);
CREATE INDEX kb_favorites_article_idx ON kb_favorites (article_id);

CREATE TABLE kb_votes (
  reader_key text NOT NULL,
  article_id uuid NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  helpful    boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reader_key, article_id)
);
CREATE INDEX kb_votes_article_idx ON kb_votes (article_id);

-- ---------- Passwords and second factors ----------
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN failed_sign_ins int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until timestamptz;
ALTER TABLE users ADD COLUMN mfa_deadline timestamptz;
ALTER TABLE users ADD COLUMN mfa_failures int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN mfa_locked_until timestamptz;
ALTER TABLE sessions ADD COLUMN mfa_verified_at timestamptz;

-- An authenticator app. The seed is encrypted with a key derived from the
-- instance secret; the last accepted step stops a code being used twice.
CREATE TABLE mfa_totp (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_encrypted text NOT NULL,
  last_used_step   bigint,
  enrolled_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at     timestamptz
);

CREATE TABLE mfa_passkeys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label         text NOT NULL,
  credential_id text NOT NULL UNIQUE,
  public_key    text NOT NULL,
  counter       bigint NOT NULL DEFAULT 0,
  transports    text NOT NULL DEFAULT '',
  device_type   text NOT NULL DEFAULT 'singleDevice',
  backed_up     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);
CREATE INDEX mfa_passkeys_user_idx ON mfa_passkeys (user_id);

CREATE TABLE mfa_recovery_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_recovery_codes_user_idx ON mfa_recovery_codes (user_id);

-- A category given for a whole import, in place of the uploaded folder's name.
ALTER TABLE kb_imports ADD COLUMN category text;

-- Where a collection's source lives, for readers who would rather go there.
ALTER TABLE kb_collections ADD COLUMN site_url text;

-- ---------- Public site visibility by rule and by category ----------
-- Why an article is held back, so a rule that no longer matches can let it go
-- while one held back by hand stays. Rules match a title, a category or
-- section name, or the file an article came from, as a literal or a regex.
ALTER TABLE kb_articles ADD COLUMN hidden_by text
  CHECK (hidden_by IN ('manual','rule','category'));
UPDATE kb_articles SET hidden_by = 'manual' WHERE public_hidden;

CREATE TABLE kb_hide_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES kb_collections(id) ON DELETE CASCADE,
  pattern text NOT NULL,
  is_regex boolean NOT NULL DEFAULT false,
  match_articles boolean NOT NULL DEFAULT false,
  match_categories boolean NOT NULL DEFAULT false,
  match_files boolean NOT NULL DEFAULT false,
  regex text NOT NULL,
  file_regex text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX kb_hide_rules_collection_idx ON kb_hide_rules (collection_id);

CREATE TABLE kb_hidden_categories (
  collection_id uuid NOT NULL REFERENCES kb_collections(id) ON DELETE CASCADE,
  category text NOT NULL,
  PRIMARY KEY (collection_id, category)
);

-- ---------- Runbooks ----------
-- A runbook is an article whose body is a procedure. Its steps are derived
-- from the body on every save, each with an id a consumer can track progress
-- by. Progress itself is never stored here.
ALTER TABLE kb_articles ADD COLUMN kind text NOT NULL DEFAULT 'article'
  CHECK (kind IN ('article','runbook'));
ALTER TABLE kb_articles ADD COLUMN steps jsonb NOT NULL DEFAULT '[]';
CREATE INDEX kb_articles_runbook_idx ON kb_articles (collection_id) WHERE kind = 'runbook';

-- ---------- Per-person knowledge base grants ----------
-- A collection granted to a person by name, read or write, whatever
-- companies the collection is kept to. The same shape as a key's grant.
CREATE TABLE user_kb_collections (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL REFERENCES kb_collections(id) ON DELETE CASCADE,
  can_write     boolean NOT NULL DEFAULT false,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, collection_id)
);
CREATE INDEX user_kb_collections_collection_idx ON user_kb_collections (collection_id);

-- ---------- Branding: text on the accent, per mode ----------
-- The instance's primary slot is light mode and the alternate slot is dark,
-- always: the row that said which mode its assets were drawn for is folded
-- into the slots. Text on the accent can be stated per mode; null picks
-- black or white, whichever reads.
UPDATE instance_branding SET
  accent = alt_accent, alt_accent = accent,
  logo_key = alt_logo_key, alt_logo_key = logo_key,
  logo_mime = alt_logo_mime, alt_logo_mime = logo_mime,
  scheme = 'light'
WHERE scheme = 'dark';
ALTER TABLE instance_branding ADD COLUMN accent_text text;
ALTER TABLE instance_branding ADD COLUMN alt_accent_text text;

-- ---------- Key grants: read by name is one choice, reactions another ----------
-- A grant row used to mean "reads by name"; now it says so with can_read, so a
-- row can also carry a permission on its own: reactions, which lets the key
-- keep favorites and votes for a named reader on that collection.
ALTER TABLE api_key_kb_collections ADD COLUMN can_read boolean NOT NULL DEFAULT true;
ALTER TABLE api_key_kb_collections ADD COLUMN reactions boolean NOT NULL DEFAULT true;

-- ---------- Secret colors: a person's own choice ----------
-- How a revealed secret is shown to them: each character colored by what it
-- is (on), the same in a color-blind-safe palette, or plain. On by default.
-- Only administrators and technicians see the choice; they are who reveal.
ALTER TABLE users ADD COLUMN secret_style text NOT NULL DEFAULT 'on';
ALTER TABLE users ADD CONSTRAINT users_secret_style_check CHECK (secret_style IN ('on','colorblind','off'));

-- ---------- Domain checks that run on their own ----------
-- The worker re-runs a record's chosen checks on an interval, keeps a compact
-- summary of the last result so the next run can say what changed, and
-- announces each expiry date once. A record can turn this off or set its own
-- interval; zero at the instance level turns it off everywhere.
ALTER TABLE domain_checks ADD COLUMN auto boolean NOT NULL DEFAULT true;
ALTER TABLE domain_checks ADD COLUMN interval_days int;
ALTER TABLE domain_checks ADD COLUMN next_run_at timestamptz;
ALTER TABLE domain_checks ADD COLUMN summary jsonb;
ALTER TABLE domain_checks ADD COLUMN warned jsonb;
ALTER TABLE domain_checks ADD COLUMN auto_error text;
ALTER TABLE domain_checks ADD CONSTRAINT domain_checks_interval_check
  CHECK (interval_days IS NULL OR interval_days BETWEEN 1 AND 365);
CREATE INDEX domain_checks_next_run_idx ON domain_checks (next_run_at);
ALTER TABLE instance_settings ADD COLUMN domain_check_interval_days int NOT NULL DEFAULT 7
  CHECK (domain_check_interval_days BETWEEN 0 AND 365);

-- ---------- Domain checks: an interval per kind, in three layers ----------
-- DNS and the certificate daily, registration and mail posture weekly, set
-- for the instance; a company may say otherwise for its records (zero turns
-- a kind off for the company), and a record for itself. A certificate that
-- renews on its own is no cause for alarm unless the record asks for a notice
-- anyway. The old single interval is gone with the row's clock split by kind.
ALTER TABLE instance_settings DROP COLUMN domain_check_interval_days;
ALTER TABLE instance_settings ADD COLUMN domain_dns_interval_days int NOT NULL DEFAULT 1;
ALTER TABLE instance_settings ADD COLUMN domain_tls_interval_days int NOT NULL DEFAULT 1;
ALTER TABLE instance_settings ADD COLUMN domain_rdap_interval_days int NOT NULL DEFAULT 7;
ALTER TABLE instance_settings ADD COLUMN domain_email_interval_days int NOT NULL DEFAULT 7;
ALTER TABLE instance_settings ADD COLUMN domain_tls_warn_days int NOT NULL DEFAULT 30;
ALTER TABLE instance_settings ADD CONSTRAINT instance_settings_domain_intervals_check CHECK (
  domain_dns_interval_days BETWEEN 0 AND 365 AND domain_tls_interval_days BETWEEN 0 AND 365
  AND domain_rdap_interval_days BETWEEN 0 AND 365 AND domain_email_interval_days BETWEEN 0 AND 365
  AND domain_tls_warn_days BETWEEN 1 AND 365);

ALTER TABLE companies ADD COLUMN domain_dns_interval_days int;
ALTER TABLE companies ADD COLUMN domain_tls_interval_days int;
ALTER TABLE companies ADD COLUMN domain_rdap_interval_days int;
ALTER TABLE companies ADD COLUMN domain_email_interval_days int;
ALTER TABLE companies ADD COLUMN domain_tls_warn_days int;
ALTER TABLE companies ADD CONSTRAINT companies_domain_intervals_check CHECK (
  (domain_dns_interval_days IS NULL OR domain_dns_interval_days BETWEEN 0 AND 365)
  AND (domain_tls_interval_days IS NULL OR domain_tls_interval_days BETWEEN 0 AND 365)
  AND (domain_rdap_interval_days IS NULL OR domain_rdap_interval_days BETWEEN 0 AND 365)
  AND (domain_email_interval_days IS NULL OR domain_email_interval_days BETWEEN 0 AND 365)
  AND (domain_tls_warn_days IS NULL OR domain_tls_warn_days BETWEEN 1 AND 365));

ALTER TABLE domain_checks DROP CONSTRAINT domain_checks_interval_check;
ALTER TABLE domain_checks DROP COLUMN interval_days;
ALTER TABLE domain_checks ADD COLUMN dns_interval_days int;
ALTER TABLE domain_checks ADD COLUMN tls_interval_days int;
ALTER TABLE domain_checks ADD COLUMN rdap_interval_days int;
ALTER TABLE domain_checks ADD COLUMN email_interval_days int;
ALTER TABLE domain_checks ADD COLUMN dns_next_run_at timestamptz;
ALTER TABLE domain_checks ADD COLUMN tls_next_run_at timestamptz;
ALTER TABLE domain_checks ADD COLUMN rdap_next_run_at timestamptz;
ALTER TABLE domain_checks ADD COLUMN email_next_run_at timestamptz;
ALTER TABLE domain_checks ADD COLUMN tls_auto_renews boolean NOT NULL DEFAULT false;
ALTER TABLE domain_checks ADD COLUMN tls_warn_days int;
ALTER TABLE domain_checks ADD CONSTRAINT domain_checks_intervals_check CHECK (
  (dns_interval_days IS NULL OR dns_interval_days BETWEEN 1 AND 365)
  AND (tls_interval_days IS NULL OR tls_interval_days BETWEEN 1 AND 365)
  AND (rdap_interval_days IS NULL OR rdap_interval_days BETWEEN 1 AND 365)
  AND (email_interval_days IS NULL OR email_interval_days BETWEEN 1 AND 365)
  AND (tls_warn_days IS NULL OR tls_warn_days BETWEEN 1 AND 365));

-- ---------- DKIM selectors a record names ----------
-- A DKIM key lives under a selector that cannot be listed, so the common ones
-- are tried and a record may name its own, comma separated, to try as well.
ALTER TABLE domain_checks ADD COLUMN dkim_selectors text;

-- ---------- Website branding as a fifth kind of domain check ----------
-- A record may read its website's own look: title, theme color, icons, and
-- the manifest. What it finds is offered to the company's theme; the record
-- whose look was applied is remembered so the choice can be shown and remade.
ALTER TABLE instance_settings ADD COLUMN domain_brand_interval_days int NOT NULL DEFAULT 7;
ALTER TABLE instance_settings DROP CONSTRAINT instance_settings_domain_intervals_check;
ALTER TABLE instance_settings ADD CONSTRAINT instance_settings_domain_intervals_check CHECK (
  domain_dns_interval_days BETWEEN 0 AND 365 AND domain_tls_interval_days BETWEEN 0 AND 365
  AND domain_rdap_interval_days BETWEEN 0 AND 365 AND domain_email_interval_days BETWEEN 0 AND 365
  AND domain_brand_interval_days BETWEEN 0 AND 365 AND domain_tls_warn_days BETWEEN 1 AND 365);
ALTER TABLE companies ADD COLUMN domain_brand_interval_days int;
ALTER TABLE companies ADD COLUMN brand_domain_document_id uuid;
ALTER TABLE companies DROP CONSTRAINT companies_domain_intervals_check;
ALTER TABLE companies ADD CONSTRAINT companies_domain_intervals_check CHECK (
  (domain_dns_interval_days IS NULL OR domain_dns_interval_days BETWEEN 0 AND 365)
  AND (domain_tls_interval_days IS NULL OR domain_tls_interval_days BETWEEN 0 AND 365)
  AND (domain_rdap_interval_days IS NULL OR domain_rdap_interval_days BETWEEN 0 AND 365)
  AND (domain_email_interval_days IS NULL OR domain_email_interval_days BETWEEN 0 AND 365)
  AND (domain_brand_interval_days IS NULL OR domain_brand_interval_days BETWEEN 0 AND 365)
  AND (domain_tls_warn_days IS NULL OR domain_tls_warn_days BETWEEN 1 AND 365));
ALTER TABLE domain_checks ADD COLUMN brand boolean NOT NULL DEFAULT false;
ALTER TABLE domain_checks ADD COLUMN brand_interval_days int;
ALTER TABLE domain_checks ADD COLUMN brand_next_run_at timestamptz;
ALTER TABLE domain_checks DROP CONSTRAINT domain_checks_intervals_check;
ALTER TABLE domain_checks ADD CONSTRAINT domain_checks_intervals_check CHECK (
  (dns_interval_days IS NULL OR dns_interval_days BETWEEN 1 AND 365)
  AND (tls_interval_days IS NULL OR tls_interval_days BETWEEN 1 AND 365)
  AND (rdap_interval_days IS NULL OR rdap_interval_days BETWEEN 1 AND 365)
  AND (email_interval_days IS NULL OR email_interval_days BETWEEN 1 AND 365)
  AND (brand_interval_days IS NULL OR brand_interval_days BETWEEN 1 AND 365)
  AND (tls_warn_days IS NULL OR tls_warn_days BETWEEN 1 AND 365));

-- ---------- Customer sign-in domains ----------
-- A visitor to the public knowledge base whom Cloudflare Access names is
-- placed with a company by the domain of their email address, and sees what
-- that company's people may. A domain names one company.
CREATE TABLE company_sign_in_domains (
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  domain      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, domain)
);
CREATE UNIQUE INDEX company_sign_in_domains_domain_idx ON company_sign_in_domains (domain);

-- ---------- The public knowledge base's own credit ----------
-- An MSP may put its own name and logo on the public site's "Powered by"
-- line in place of the vendor's. The license and the source link stay.
ALTER TABLE instance_branding ADD COLUMN kb_powered_by_name text;

-- ---------- Roles as rows ----------
-- The three roles the product started with become rows, marked built in and
-- fixed; an administrator may add roles carrying any subset of the named
-- permissions. users.role now names a row rather than one of three words.
CREATE TABLE roles (
  key          text PRIMARY KEY,
  name         text NOT NULL,
  description  text,
  permissions  text[] NOT NULL DEFAULT '{}',
  builtin      boolean NOT NULL DEFAULT false,
  archived_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO roles (key, name, description, permissions, builtin) VALUES
  ('admin', 'Administrator', 'Everything, including the administration area.',
    '{hierarchy.manage,documents.edit,doc_types.manage,secrets.fields,kb.write,admin.area}', true),
  ('tech', 'Technician', 'Creates and edits documents, adds local fields, promotes fields, adds dropdown options.',
    '{documents.edit,secrets.fields}', true),
  ('readonly', 'Read-only', 'Views what their companies allow.', '{}', true);
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_roles_key_fk FOREIGN KEY (role) REFERENCES roles(key);

-- ---------- An operator's own tab icon ----------
-- One per mode. Without one the product mark in the accent is the tab icon;
-- with one it serves both modes, and with two the browser picks by mode.
ALTER TABLE instance_branding ADD COLUMN icon_key text;
ALTER TABLE instance_branding ADD COLUMN icon_mime text;
ALTER TABLE instance_branding ADD COLUMN alt_icon_key text;
ALTER TABLE instance_branding ADD COLUMN alt_icon_mime text;

-- ---------- Network fields ----------
-- IP address (one host, stored addr/prefix), network (a block, snapped to its
-- boundary), IP range, MAC address, VLAN ID, hostname. A MAC field writes
-- addresses in its own format, or the instance's when it names none.
ALTER TABLE fields DROP CONSTRAINT fields_field_type_check;
ALTER TABLE fields ADD CONSTRAINT fields_field_type_check CHECK (field_type IN (
  'text','markdown','richtext','number','date','url','ip','network','ip_range','mac','vlan',
  'hostname','boolean','dropdown','multi_dropdown','doc_link','secret_ref'));
ALTER TABLE fields ADD COLUMN mac_format text CHECK (mac_format IS NULL OR mac_format IN (
  'colon_upper','colon_lower','hyphen_upper','hyphen_lower','dot_lower','dot_upper',
  'bare_upper','bare_lower'));
ALTER TABLE instance_settings ADD COLUMN mac_format text NOT NULL DEFAULT 'colon_upper'
  CHECK (mac_format IN ('colon_upper','colon_lower','hyphen_upper','hyphen_lower','dot_lower',
    'dot_upper','bare_upper','bare_lower'));
