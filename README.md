# Trove KB

Self-hosted, open-source structured IT documentation for internal IT teams and MSPs.
A lightweight alternative to Hudu and IT Glue.

- Companies > Locations > Documents hierarchy
- Documents built from templates (doc types) with typed fields
- Add fields and dropdown options inline while editing. No round trips to admin.
- Markdown and rich text fields, drag-and-drop field ordering
- Link documents to each other, with backlinks on the target
- Full-text search across every document, no extra service
- Attachments on a local volume or any S3-compatible bucket
- Credentials stay in your own Bitwarden or Vaultwarden; Trove KB brokers access
- Local accounts or OIDC single sign-on, with an append-only audit trail
- en-US and en-GB interface, switchable per reader
- A knowledge base beside the documentation: vendor help sites, wikis, and
  manuals brought in by import or crawled on a schedule, searched and read in
  one place, with runbooks whose steps a ticketing system can track
- A public site for the collections you choose, with favorites and ratings,
  and keyword rules that keep the rest off it
- MCP endpoint so AI assistants can read your documentation, never your secrets
- Runs as a Docker container, or as a Cloudflare Worker with no server at all
- Per-company export as JSON or Markdown
- REST API + signed webhooks for any PSA or ticketing system, the knowledge
  base and runbooks included
- Deep links and an id mapping so a ticket can jump straight to its client
- One `docker compose up` to run

License: AGPL-3.0. Contributions require DCO sign-off (see CONTRIBUTING.md).

## Quick start
```bash
cp .env.example .env
# set POSTGRES_PASSWORD, match it in DATABASE_URL, and:
#   openssl rand -base64 32   -> AUTH_SECRET
docker compose up -d
```
App: http://localhost:3080 — the first visit opens a one-time setup screen that
creates the administrator account. Migrations run automatically on container start.

Set `SEED_ON_START=true` to load the starter doc types (see `scripts/seed.ts`).
Change the published port with `APP_PORT` in `.env`, and keep `APP_URL` in step —
Better Auth rejects requests whose origin does not match it.

## API

`/api/v1`, authenticated with an API key (Admin → API keys) in the `X-Auth-Token`
header. `Authorization: Bearer <key>` and `X-API-Key` are accepted too.
The spec is generated from the same Zod schemas the endpoints validate with and
served at `/api/v1/openapi.json`.

```bash
curl -H "X-Auth-Token: $TROVE_KEY" http://localhost:3080/api/v1/companies
curl -H "X-Auth-Token: $TROVE_KEY" \
  "http://localhost:3080/api/v1/lookup?system=halopsa&entity=company&external_id=123"
```

Webhooks are signed with HMAC-SHA256 in `X-Trove-Signature` (`sha256=<hex>` over
the raw body) and retried with exponential backoff up to 8 attempts by a worker
inside the app container. Set `TROVE_DISABLE_WEBHOOK_WORKER=true` to turn that
worker off, for example on a second replica.

## Secrets

Trove KB never stores a password, TOTP seed, or secure note. A `secret_ref` field
holds a reference plus non-secret metadata; the value itself is fetched live
from your own Bitwarden or Vaultwarden when someone with `can_reveal_secrets`
asks for it, and every reveal is audited.

- `VAULT_MODE=link` (default) stores a deep link into the web vault. No trust
  required, nothing to run.
- `VAULT_MODE=bw_serve` brokers search, reveal, TOTP, and item creation through
  a sidecar running the official Bitwarden CLI:
  `docker compose --profile vault up -d`. The sidecar has no authentication of
  its own, so it never publishes a port and stays on the internal network.

If the sidecar is locked or unreachable, secret fields degrade to link mode and
say so.

**Worth being plain about:** in `bw_serve` mode, anyone who fully compromises
the Trove KB host can read everything the service account can read. That is the
same tradeoff Hudu and IT Glue make. Scope the service account to the
collections Trove KB should see, keep the sidecar internal, and stay on `link`
mode if that risk is unacceptable. See `docs/VAULT_INTEGRATION.md`.

## AI access (MCP)

Trove KB speaks the [Model Context Protocol](https://modelcontextprotocol.io) at
`/api/mcp`, so an assistant can answer "what is the firewall admin URL for this
client?" from your documentation rather than guessing. It uses the same API
keys as the REST API, so access is granted and revoked in one place.

```bash
claude mcp add --transport http trove-kb https://trove-kb.example.com/api/mcp \
  --header "X-Auth-Token: $TROVE_KEY"
```

Documentation tools are read-only: `search_documents`, `get_document`,
`list_companies`, `get_company`, and `list_doc_types`. Knowledge base tools
read too (`list_kb_collections`, `search_kb`, `get_kb_article`,
`list_kb_articles`), and a key granted write on a collection also gets
`upsert_kb_article` and `archive_kb_article`, so an assistant working in a
code repository can keep that product's own documentation current. A key needs
only the `read` scope; writing is a grant per collection.

**No assistant can read a credential.** Secret fields are stripped from every
MCP response, and there is deliberately no reveal tool — revealing a credential
stays a decision a person makes in Trove KB, where it is audited. Nothing exposed
over MCP can change client documentation.

## Knowledge base

Collections hold reference articles from outside sources, kept apart from
client documentation: a vendor's help center read by its own structure, a
website crawled by sitemap or from a starting page, a wiki or an export of
another system's articles brought in as a zip or a folder, with their pictures
and the PDFs and Word documents they link. Imports upsert on a stable id, so a
newer export updates what changed and nothing else. What comes in is tidied to
read as its source did: numbered steps keep counting past a screenshot, a
site's own menus and buttons are dropped, and an embedded video plays in the
article.

Articles can also be written in Trove KB, by administrators and by people
granted a collection by name. A **runbook** is an article whose lists are a
procedure: every step carries a stable id, written into the body, so a
ticketing system that links the runbook can keep per-ticket progress by step.
Trove KB stores none of that progress itself.

The **public site** publishes the collections you choose at a hostname of its
own, with search, favorites, and "was this helpful" votes, and recognizes
readers who arrive through Cloudflare Access without any account here. Keyword
rules (phrases or regular expressions, by title, category, or file type) and
per-category switches keep the rest off it, and apply to what arrives later.

Everything the app can do with the knowledge base, a program can do over
`/api/v1/kb`: list and search collections and articles, read one in full with
its steps, upsert and archive under an external id, grant collections to
people and keys, and subscribe to `kb.article.upserted` and
`kb.article.archived` webhooks. See `docs/API.md`.

## Running it on Cloudflare

Two ways. Put the container behind a **Cloudflare Tunnel** and it is published
at `https://trove-kb.yourdomain.com` with no port open to the internet: install
`cloudflared` on the host, point a public hostname at `127.0.0.1:3080`, set
`APP_URL` to the hostname, and set `APP_BIND=127.0.0.1` so nothing but the
tunnel can reach it. Everything else — the vault sidecar included — stays as it
is.

Or run it as a **Cloudflare Worker** with no server at all, with Postgres behind
Hyperdrive, attachments in R2, and webhook retries on a Cron Trigger:

```bash
npm run cf:build && npm run cf:deploy
```

`docs/CLOUDFLARE.md` has the full walkthrough, including how to keep brokered
secrets by running the vault sidecar on your own network behind a Cloudflare
Tunnel. Both deployments share a schema and hash format, so you can move
between them.

## Backups

Attachments can live on the NAS instead of a local volume:
`docker compose -f docker-compose.yml -f docker-compose.nfs.yml up -d`, with
`NFS_SERVER` and `NFS_UPLOADS_PATH` set. Uploaded files are write-once,
read-many, which is what a share is good at; the database stays on local disk,
because it is hot data.

`docs/BACKUP.md` covers what to keep, how to restore it, and how to verify a
dump before you need it. In short: `pg_dump` the database, archive the uploads
volume, and store `.env` with them.

## Language

The interface ships in en-US, with en-GB available as a translation. Readers
pick their own in the account menu; `APP_LOCALE` sets what a new visitor gets,
and `SEED_LOCALE` sets the wording of the seeded starter content (so a British
install gets "Fibre" rather than "Fiber"). Dates and numbers follow the same
choice.

Adding a language means one file: copy `src/i18n/en-GB.ts`, override only the
strings that differ from `src/i18n/en-US.ts`, and add the code to
`src/i18n/locales.ts`. Anything left out falls back to en-US, so a partial
translation is still usable.

## Rack elevations

A Rack document draws itself: tell it how many units it has, whether the back
is used, and which way its rails are numbered, then mount things — an existing
Switch or Server document, or a plain label for the patch panel nobody will
ever write up. You get a printable SVG for each face and a list of what is
where, with the documented items linked.

Color comes from the kind of equipment. Set it once for every client, and let
a client override it where their own conventions differ; the key says which
colors are overrides and what the default was. Trove KB also says when two
colors are too close to tell apart in print, when an override has landed on a
color already in use in that rack, and when two things claim the same unit.

## Domain checks

A domain record can look itself up: DNS records and who is answering for the
domain, the TLS certificate and how long it has left, the registry's own
registration record, and whether SPF, DMARC and DKIM are published. Tick the
checks you want on a record and press **Check now**, or leave **Check
automatically** on and the worker re-runs them, each on its own clock: DNS and
the certificate daily, registration and mail posture weekly. Those are the
instance's defaults, set under Admin → Settings; a company can set its own
timings for its records on its edit page, and a record its own, so a new
record follows its company and, through it, the instance. TXT records are
listed one per line with what each is for named: SPF, DMARC, DKIM, and the
verification tokens of Google, Atlassian, Microsoft 365 and the rest. The
result is kept, so reading a page costs no lookups.

When a run finds something different from the run before — the name servers
moved, a new certificate, a registrar change, DMARC gone — a `domain.changed`
webhook names each change. A certificate inside its notice (30 days unless
the instance, the company or the record says otherwise) or a registration
within 60 is a `domain.expiring` webhook, once per expiry date. A record can
say its certificate renews on its own, and then nothing is announced about
it unless the record asks for a notice anyway.
**Admin → Notifications** lists what the last check of every domain record
flagged, so nobody has to subscribe to a webhook to find out.

What it finds is offered, never applied: RDAP knows the registrar and the
expiry date, and the answer sits beside the field with a **Use this** button.
Accepting one is an ordinary edit, with a revision and an audit entry.

A domain is typed by a person, so a lookup is treated as untrusted: names are
resolved first, anything resolving inside your network is refused, and the
connection is made to the address that was checked.

## Shared lists versus links

A field that names something shared across clients — a registrar, a DNS host,
an internet provider — is a dropdown on an instance-wide list, so nobody
re-creates Cloudflare for the fortieth client. A field that names *that
client's* own record — which circuit a firewall sits on — stays a link to the
document. Lists are editable from inside any document with the "+", and what
you add is there for every company afterwards.

## Attachments

Each document takes files: images, PDF, Word, Excel, PowerPoint, CSV, Markdown,
and plain text, up to `MAX_UPLOAD_MB` (25 by default). HEIC and HEIF photos are
converted to JPEG as they are stored, so a picture taken on a phone opens for
everyone.

What a file *is* comes from its own bytes. Renaming an executable to `.png`
does not get it in, and a macro-enabled Office document is refused whatever
extension it arrives under. Downloads are always served as attachments, with
`nosniff`, so an uploaded file can never execute on the site's origin.

## Review schedules

A document can say when it needs looking at again: a date that arrives once —
a certificate, a contract, a domain — or a job that comes round, like a UPS
battery every two years. Each carries a lead time, so it starts asking before
the date rather than on it.

**Admin → Notifications** lists what is due or overdue across every company you
can see, and a `document.due` webhook goes out when something arrives there,
once per date. Marking a recurring job done rolls it forward on its own
cadence: done three days late, the next one is still on the original date, so
lateness does not compound.

## Administration

Admin is its own area, reached from the avatar menu rather than the sidebar —
the sidebar is for the documentation. Inside, a rail of its own: Users,
Notifications, Settings, Branding, then doc types, option lists, API keys, the
vault, and the audit log. **Settings** holds the default language a reader gets
before they choose one, and shows the configuration the environment supplies so
nobody has to read a compose file to see how their instance is running.

## Branding

**Admin → Branding** sets a portal name, a logo, and one accent color. The name
replaces the product name in the top bar, the browser tab, and on the sign-in
page; the logo appears beside it and doubles as the tab icon.

Until you set any of that, the portal wears its own: a teal accent, and a cut
gem as the mark beside the name and in the tab. The mark takes the accent of
the mode the reader is in, in the header and in the tab alike: with a
different accent per mode the tab icon switches with the browser (Firefox and
Chromium; Safari and home-screen icons keep the light-mode accent). Upload a
logo and it takes the mark's place in the header; the tab keeps the mark,
since a logo is drawn for a masthead, not a 16-pixel square. If you would
rather have your own tab icon, upload one per mode (PNG, WebP, or ICO) under
the logos; one icon serves both modes, two switch with the browser the same
way, and Remove brings the mark back.

Each company can carry a logo and accent of its own, set on its edit page, and
they show on that company's pages and its documents. The shell keeps your
branding, so it stays clear which portal you are looking at.

Branding says which mode it was drawn for, because a logo made for a white
background disappears on a dark one. Say whether your set is for light or dark,
and Trove KB offers the other: a second logo and, if you want it, a second color,
so the portal stays on brand in both. A color you state for a mode is used in
that mode exactly as you gave it; a mode you leave empty gets one derived from
the other, adjusted until it is readable. The branding screen previews both
themes side by side, each genuinely rendered, so you can see the one you are
not using.

Logos are PNG, JPEG, or WebP — SVG is refused, because an SVG can carry script
and a logo is drawn on every page.

The footer carries two things that are not the same. The credit — "Powered by
Trove KB | Hearne Technologies" — names the product and who makes it, and an
operator who would rather not show it can turn it off in Admin → Branding. The
license and the link to the source stay either way: AGPL-3.0 §13 asks that
anyone using this over a network can get at the source, which is not an
operator's to remove.

## Who can see which companies

Roles say what somebody may do; company access says where. The three roles the product starts with are fixed; under **Admin → Roles** you can see what each may do and add roles of your own with any mix of the same powers. A user or an API key
either sees every company or only the ones granted to it, under **Admin →
Users** and on the key itself. Administrators are never restricted — they are
who grants access.

A newly created account starts with no companies until an admin grants some, so
an SSO user who signs in for the first time cannot read anything by default.
Upgrading an existing install changes nothing: everyone who is already there
keeps the access they had.

Anything outside the granted set answers "not found" rather than "you are not
allowed", because saying a company exists but is not yours is itself a
disclosure. The rule holds across search, backlinks, exports, attachments, deep
links, the REST API, and the MCP tools, which inherit their key's companies.

## Appearance

Light and dark are one palette, selected by `color-scheme` and resolved with
`light-dark()`, so there is no second set of styles to keep in step. The
account menu offers System, Light, and Dark; System follows the operating
system and is what a new reader gets.

The choice is a cookie read on the server, so the right palette is in the first
byte of HTML — no script, and no flash of the wrong colors on load.

## Accounts, passwords, and the second step

Trove KB has accounts of its own, so it has a second sign-in step of its own.
Single sign-on in front of it, or Cloudflare Access, does not stand in for it.

Passwords are 8 to 128 characters with an uppercase letter, a lowercase
letter, a number, and a symbol or a space, never the person's own name or
address, and never one that has appeared in a known breach (asked of the Pwned
Passwords service by k-anonymity, so the password itself never leaves the
server). They do not expire on a timer. Ten wrong passwords in a row close an
account for fifteen minutes; an administrator can open it again. Set
`SMTP_URL` and `MAIL_FROM` and the sign-in page offers a reset link by mail;
without them, an administrator sets a temporary password under Admin → Users,
which must be changed at the next sign-in.

Under the account menu, Personal settings → Security, anyone can enroll an
authenticator app, passkeys (a YubiKey, or the passkey a phone, laptop, or
password manager holds), or both, and receives ten single-use recovery codes.
Administrators must enroll something within a week of their first sign-in;
the pages that issue API keys, change people, or change security settings ask
for the step again after fifteen minutes. An administrator who has lost
everything is put right by another administrator from Admin → Users, and it is
all in the audit log.

## Single sign-on

Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` (all three or
none) and the sign-in page offers SSO alongside local accounts. `APP_URL` must
be the origin people actually browse to: the redirect URI and the cookie that
carries the OAuth state are both built from it, so a mismatch fails the
callback with `state_mismatch`. Discovery is
used, so Entra ID, Google, Authentik, and Keycloak all work. Accounts created
this way start with the `tech` role and cannot reveal secrets until an
administrator says so under Admin → Users.

## Development
```bash
npm install
npm run dev          # http://0.0.0.0:3080
npm run db:migrate   # apply migrations against DATABASE_URL
npm run db:seed
npm test             # Vitest service tests
npm run lint
npm run typecheck
```

End-to-end tests drive the inline editing flows in a real browser against a
running instance:

```bash
APP_PORT=3090 docker compose -p trove-kb-test up -d     # a throwaway stack
npx playwright install chromium                       # first time only
E2E_BASE_URL=http://127.0.0.1:3090 npm run test:e2e
docker compose -p trove-kb-test down -v
```

The tests read the database directly. If your `.env` sets a database role
other than the default, pass it along with `E2E_DB_USER`.

The single sign-on test runs a mock identity provider published on host port
18080. If something on the host already holds that port, choose another with
`E2E_OIDC_PORT`.

The footer of the signed-in pages names the release it is, `v1.2.3`, read
from `package.json`. To cut a release, set that version first, then tag it
the same, and the Release workflow publishes the notes:

```bash
npm version 0.2.0 --no-git-tag-version   # package.json and the lockfile
git commit -sam "Release 0.2.0"
git tag v0.2.0 && git push && git push --tags
```

The workflow refuses a tag that does not match `package.json`, so the
version people see is always the one that was released.

`db/schema.sql` is the reference data model, `src/server/db/schema.ts` mirrors it,
and the SQL in `drizzle/` is what actually runs. Change all three together:
`npm run db:generate` writes a new migration from the Drizzle schema.
