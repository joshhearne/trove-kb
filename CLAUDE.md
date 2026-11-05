# CLAUDE.md

Guidance for Claude Code working in this repo. Read docs/ARCHITECTURE.md and docs/API.md first.

## Project
Trove KB: self-hosted, AGPL-3.0 structured IT documentation (Hudu/IT Glue alternative).
Standalone product. Integrates with any PSA through the REST API, external refs, and webhooks.
No coupling to any specific PSA in core code.

## Non-negotiables
- Users must never need to leave a document to add a field, add a dropdown option, or reorder fields.
- Field values are keyed by field UUID. Never by label.
- Never hard-delete fields, option items, or doc types. Use `archived_at`.
- Every document save writes a revision and an audit log entry.
- All input validated with Zod. Same schemas generate the OpenAPI spec.
- Sanitize richtext HTML server-side.
- Never store, cache, log, export, or webhook a password, TOTP seed, or secure note. Secrets are fetched live from the vault provider on reveal only.
- The bw-serve sidecar never publishes a port.
- Every read of company-owned data takes a `CompanyScope`. Out of scope is "not found", never "forbidden".
- An uploaded file's type comes from its own bytes, never from what the browser claimed.
- A lookup aimed at a user-supplied name resolves first, refuses non-public addresses, and connects to the address it checked.
- A knowledge base article is never a document and never belongs to a company. Every read of one takes a `KbReader`.
- Everything runs from `docker compose up`. No required external services beyond Postgres.

## Conventions
- TypeScript strict. Server actions for UI mutations, route handlers under `app/api/v1` for the public API.
- Business logic lives in `src/server/services/*`, shared by server actions and API routes. No logic in route files.
- Drizzle schema in `src/server/db/schema.ts`, mirroring `db/schema.sql`. Migrations via drizzle-kit.
- Tests: Vitest for services, Playwright for the inline-editing flows.
- Branches: work and pull requests go into `dev`; `main` is released code only. A user-visible
  change adds a file to `changes/` (see `changes/README.md`), written for the people using it.
- Commits signed off (`git commit -s`). Commit messages are en-US only, like everything else
  here: "color", not "colour"; "license", not "licence".
- en-US is the source language: code, comments, docs, identifiers, and the base catalog in `src/i18n/en-US.ts`. Never hardcode interface copy in a component — add a key and read it through `getMessages()` (server) or `useMessages()` (client).
- Other locales are overrides on the base catalog (`src/i18n/en-GB.ts`), so a translation only states what differs and can never miss a key.
- Format dates and numbers with the reader's locale through `src/i18n/format.ts`, never the server default and never a hardcoded `en-US`.

## Build phases
Work one phase at a time. Each phase ends with passing tests and a working compose build.

### Phase 0: Skeleton
Next.js app, Dockerfile (multi-stage, standalone output), compose, Drizzle schema + first migration, seed script, Better Auth with local accounts, first-run admin setup screen.

### Phase 1: Hierarchy
Companies and locations CRUD. Company page lists locations and documents grouped by doc type. Sidebar navigation.

### Phase 2: Doc types and documents
Admin page for doc types and template fields. Document view and edit pages. All field types except doc_link and secret_ref. TipTap for markdown/richtext. Revisions on save.

### Phase 3: Inline editing (core differentiator)
Add local field from edit mode. Promote to template. Dropdown "+" to add options. dnd-kit reordering with "this doc / update template" choice. Archive fields.

### Phase 4: Links, search, attachments
doc_link fields with backlinks. Global search (tsvector). Attachments with local/S3 drivers.

### Phase 5: API and integrations
API keys (admin UI), `/api/v1` endpoints, OpenAPI spec, external refs, `/lookup`, `/go/...` deep links, webhooks with retry worker.

### Phase 6: Vault integration
Read docs/VAULT_INTEGRATION.md. VaultProvider interface with `link` and `bw_serve` implementations.
bw-serve sidecar (compose profile `vault`). Company to collection mapping UI. secret_ref item picker scoped to the company's collection.
Reveal password and TOTP with permission check, audit, no-store. Create item from doc when allowed. Graceful fallback to link mode.
Bitwarden Public API add-on (collection per company, event log import) only after the rest works.

### Phase 7: Polish for release
OIDC login, audit log viewer, export (JSON + markdown per company), backup/restore docs, starter doc type pack (ISP, Firewall, Switch, Wi-Fi, Printer, Server, Domain/DNS, M365 tenant, Vendor).

### Phase 8: Per-company access
Grants per user and per API key (`user_companies`, `api_key_companies`), default-deny for new rows,
admins unrestricted. Enforced in the service layer, not in pages. See docs/ARCHITECTURE.md.

### Phase 9: Branding
Instance name/logo/accent and the same per company. Accent is validated hex, re-derived per surface
for contrast; logos are raster only, sniffed by magic bytes. See docs/ARCHITECTURE.md.

### Phase 10: Attachment policy
Accepted types decided by magic bytes; HEIC/HEIF converted to JPEG; macro-enabled and legacy
Office refused. See docs/ARCHITECTURE.md.

### Phase 11: Domain checks
DNS, TLS, RDAP and email posture per domain record, run on request or by the worker, each kind
on its own interval set in three layers (instance, company, record; `src/server/domain/policy.ts`)
with per-record opt-out. Each run is compared with the last: `domain.changed` names what differs,
`domain.expiring` warns once per expiry date within the certificate notice (none for a certificate
marked as renewing itself), and Admin → Notifications lists what was flagged. TXT records are
named by kind. Field roles (`fields.domain_role`) decide which field holds the domain. See
docs/ARCHITECTURE.md.

### Phase 12: Rack elevations
Rack doc types (`doc_types.is_rack`) with `racks` / `rack_mounts` / `rack_type_colors`. Color is
per equipment kind: MSP default, client override, built-in palette. Closeness is judged in Oklab.
See docs/ARCHITECTURE.md.

### Phase 13: Schedules
Per-document expiry and recurring maintenance, a lead time, `document.due` webhooks announced once
per date, and Admin → Notifications listing what is due. See docs/ARCHITECTURE.md.

### Phase 14: Knowledge base
Collections of articles from outside sources (`kb_collections` / `kb_articles` / `kb_chunks`),
kept apart from documents. Import from a zip, a folder, or a connector; upsert on
(collection, source key); keyword search over chunks; read through MCP, and written through it by
a key granted that on a collection. See docs/ARCHITECTURE.md.

#### Bringing documentation in
An imported article must read as its source did. Every converter (`src/server/kb/html.ts`, the
archive extractors, a browser-side exporter) and every stored body is held to this:
- Numbered steps keep their numbers and keep counting. A picture, a note, or a caption that sits
  between two steps belongs to the step above it, indented under it, never left at the margin
  where it ends the list and the next step starts again at 1. A list restarts only where the
  source restarts: under a heading or a plain-text title.
- No blank-line gaps that split one list into two. Nested lists are indented under their item.
- A section title the source numbers (`<ol><li><h2>`, `<p class="h2">`) is a heading, not an
  empty list item with its text on the next line.
- A source site's own in-page navigation is never kept: breadcrumbs, "MENU" / "Contents" lists
  of `#anchor` links, print and share buttons. Trove KB builds its own outline from the article's
  headings (`src/server/kb/outline.ts`, `KbOutline`): on the right of the text on a wide
  screen, a button at the foot of the screen on a narrow one, and only when there are headings.
- Pictures and files come along: `images/` and `files/` folders in an archive are attachments,
  a crawled page's pictures are kept by their address, the original document is kept and offered.
- Categories come from the source's structure (folder, breadcrumb, help-center section), and a
  folder named on import overrides them.
- `tidyImportedMarkdown` (`src/server/kb/tidy.ts`) runs on every imported Markdown body and
  `scripts/kb-tidy.ts` runs it over what was imported earlier. Articles written through a key
  are never touched. Teach a new source's quirk to the converter first, and to the tidy only
  when it is in the stored text already.
- Check a new source by importing it and reading three articles with steps against their
  originals before importing the rest.

### Phase 15: Accounts and second factors
Password policy with live validation and a breach check, lockout on guessing, temporary
passwords that must be changed, reset by mail when SMTP is set. Second factors: authenticator
app, passkeys, recovery codes; required for admins after a week, offered to everyone; the
session is stamped and the sensitive pages ask again. Admins reset a person's factors from the
UI. See docs/ARCHITECTURE.md.

### Phase 16: Roles
Roles are rows with a permission set (`roles`, `src/server/auth/permissions.ts`); the built-in
three are fixed, custom ones any subset, chosen under Admin → Roles. Every check names its
permission. "Administrator" means the role holds the admin area. See docs/ARCHITECTURE.md.

### Phase 17: Updates
Production / development / manual channels chosen under Admin → System health, carried out by
the host updater in `updater/` (systemd timer, never root; Docker or bare metal), with backup,
health check and rollback. A What's new pop-up per release from `changes/*.md`, filtered by
audience. Pull requests go into `dev`; a release is a tag on `dev`, and `main` fast-forwards to it. See
docs/ARCHITECTURE.md.

### Later
Tags, multi-tenant, importers (Hudu, IT Glue CSV).
