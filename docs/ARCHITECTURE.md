# Architecture

## Stack
| Layer | Choice | Why |
|---|---|---|
| App | Next.js (App Router), TypeScript | One deployable for UI + API |
| DB | PostgreSQL 16 | JSONB for field values, built-in full-text search |
| ORM | Drizzle | Typed, SQL-first, easy migrations. `db/schema.sql` is the reference model |
| Auth | Better Auth | Local accounts + OIDC (Entra, Google, Authentik) |
| Editor | TipTap | Rich text and markdown input in one component |
| Drag and drop | dnd-kit | Field reordering |
| UI | Tailwind + shadcn/ui | Fast, accessible, easy for contributors |
| Validation | Zod | Shared between UI, API, and OpenAPI generation |
| Search | Postgres tsvector | No extra service. Meilisearch optional later |
| Files | Local volume or S3-compatible | Driver set via env |

Single container plus Postgres, with an optional bw-serve sidecar for Bitwarden/Vaultwarden. No Redis, no queue service. Webhook retries run from a lightweight in-process worker polling `webhook_deliveries`.

## Core concepts
- **Company** > **Location** > **Document**. A doc type's `scope` decides whether its documents attach to a company or a location.
- **Doc type** = template. Owns an ordered set of fields.
- **Field** belongs to a doc type (template field) OR a single document (local field). Never both.
- **Promote**: moving a local field onto its doc type. One UPDATE. Existing docs of that type get the new empty field.
- **Option list**: shared dropdown source. Any dropdown field references one. The "+" button inserts an item inline.
- **Values** live in `documents.field_values` keyed by field UUID. Labels can change freely.

## Field value storage
| field_type | Stored as |
|---|---|
| text, url | string |
| ip | `address/prefix` string; a blank prefix is saved as /32 (IPv4) or /128 (IPv6) |
| ip_list | array of `address/prefix` strings, in order, no repeats, at most 32 |
| network | `network/prefix` string, host bits cleared; prefix /0–/31 (IPv4) or /0–/127 (IPv6) |
| ip_range | `first-last` string, same family, first ≤ last |
| mac | string in the field's MAC format (its own, else the instance's) |
| vlan | number, 1–4094 |
| hostname | lowercase string, trailing dot dropped |
| port | `port[/protocol]` string, 1–65535; protocol `tcp`, `udp`, or `tcp+udp` |
| port_range | `first-last[/protocol]` string, first ≤ last; a range of one is saved as one port |
| markdown | markdown source string |
| richtext | sanitized HTML string (sanitize server-side on write) |
| number | number |
| date | ISO date string |
| boolean | boolean |
| dropdown | option_item UUID |
| multi_dropdown | array of option_item UUIDs |
| doc_link | document UUID (also written to `document_links`) |
| secret_ref | object with vault item/collection ids plus cached non-secret metadata. See VAULT_INTEGRATION.md |

API responses return resolved values (option labels, linked doc titles, rendered HTML for markdown) alongside raw IDs.

### The markdown and richtext editor
One TipTap editor (`src/components/fields/rich-text-editor.tsx`) serves both
field types, with tables (`@tiptap/extension-table`) and checklists
(`TaskList`/`TaskItem`). Text pasted in is parsed as Markdown
(`tiptap-markdown`, `transformPastedText`), so a `.md` file pasted whole keeps
its headings, lists, tables, and `- [ ]` items instead of arriving as literal
markers that the serializer would then escape (`\#`, `\|`); Shift+paste keeps
it plain. A markdown field also has a **Visual | Markdown** switch: the second
is the source in a textarea, and going back re-parses it. On the view side
`marked` (GFM) renders the source and `sanitizeRichText` allows the result: an
`<input>` survives only as a disabled checkbox, whatever it claimed to be.

### Network fields
`src/lib/net/ip.ts` and `src/lib/net/mac.ts` hold the parsing and arithmetic,
with no server-only imports, so validation (`fields/values.ts`), rendering
(`fields/render.ts`), and the editor's live preview all use the same code.

- **IP address** (`ip`) is one host. The control is the address plus a prefix
  select; blank means the single address and is saved as /32 or /128. A prefix
  records the subnet the host sits on, and the document view shows the block
  it works out (network, mask, wildcard, broadcast, usable range and count).
- **Network** (`network`) is a block. The prefix is required and stops short of
  a single address, and the host bits are cleared on save: 192.168.1.77/24 is
  kept as 192.168.1.0/24. The view badges "Network" against "Address" so the
  two never read alike.
- Both accept `10.0.0.5/24`, `10.0.0.5/255.255.255.0`, and
  `10.0.0.5 255.255.255.0`, typed, pasted, or sent through the API. IPv6 is
  written per RFC 5952. IPv4 /31 counts both addresses (RFC 3021).
- **MAC address** (`mac`) is stored in a format: colons, hyphens, dotted
  groups of four, or none, each upper or lower case. `fields.mac_format`
  chooses one per field; null follows `instance_settings.mac_format` (Admin →
  Settings → Network fields). The editor rewrites a whole address into the
  format as it is typed or pasted, the server does the same on save, and the
  view and the API's `resolved` show stored values in the format in force now.
  Search indexes the bare and colon spellings too.
- **IP address list** (`ip_list`) is several hosts in order, such as DNS
  servers, primary first. Each row is an IP address control with its own
  prefix; rows reorder with arrows, and a paste of several addresses
  (commas, spaces, new lines) fills a row for each.
- **Port** (`port`) and **Port range** (`port_range`) sit beside a protocol
  selector, which may stay blank. `src/lib/net/port.ts` reads "443/tcp",
  "tcp 443", "udp:53", "5060:5080 udp", and well-known service names
  ("https" is 443/tcp); the view names the service on a well-known port.
- **IP range** (`ip_range`), **VLAN ID** (`vlan`) and **Hostname** (`hostname`)
  validate their shape and nothing more.

## Inline editing rules (the whole point of the project)
1. Edit mode shows every field of the document, template fields first, then local fields, respecting `field_order` if set.
2. "Add field" in edit mode creates a local field on that document.
3. Each local field has "Add to template" (admin/tech permission). Promoting prompts once: confirm label, type, and option list.
4. Dropdowns show a "+" next to the select. Adding an option writes to the shared list and selects it.
5. Drag handle on each field. Reordering a template field in a doc asks: "this doc only" or "update template."
6. Archiving a field hides it everywhere; values stay in JSONB so revisions still render.
7. Every save writes a `document_revisions` row and an `audit_log` row, and queues webhooks.

## Permissions
A role is a row in `roles` carrying a set of named permissions
(`src/server/auth/permissions.ts`): companies, documents, doc types, secret
fields, knowledge base writing, and the administration area. The three the
product started with are rows marked built in and fixed:
- admin: everything, including deleting doc types and managing API keys/webhooks
- tech: create/edit docs, add local fields, promote fields, add dropdown options
- readonly: view only

An administrator adds roles under Admin → Roles with any subset. Every check
names its permission and reads the role's set from a copy held per request
(`src/server/auth/roles.ts`: loaded once a request has a user, refreshed every
thirty seconds, dropped when a role changes here). A role holding the
administration area is an administrator in every sense: it sees every
company, must keep a second factor, is excluded from grant lists, and is who
grants access. Revealing a secret stays a per-person flag. A role is retired,
never deleted, and only when nobody holds it.

## Per-company access (v2)
A principal — a signed-in user or an API key — either sees every company or
only the ones granted to it. The role decides what it may *do*; the grant
decides *where*.

- `users.all_companies` / `user_companies`, and `api_keys.all_companies` /
  `api_key_companies`. A new row defaults to false: access is granted, never
  assumed.
- Administrators are never restricted. They are who grants access.
- A user's scope is read from the database on every request, not from the
  session, so revoking a grant applies to the next page load.
- Out of scope reads as **not found**, never as forbidden. Saying a company
  exists but is not yours is itself a disclosure. The one exception is creating
  a company with a restricted key, which is a 403 that says why, because the
  alternative is a company the key could never see.
- Enforcement lives in the service layer: every read of company-owned data
  takes a `CompanyScope`, list queries filter in SQL, and single-record reads
  assert. A restricted principal with no grants matches no row, rather than
  producing an empty `IN ()`.
- It reaches search, backlinks, revisions, attachments, exports, the vault item
  picker, external-ref mapping, `/lookup`, `/go/...` deep links, and the MCP
  tools, which inherit the key's companies.

## Schedules
`document_schedules` is one row per document: a kind (`expiry` or
`maintenance`), the next date, a lead time, and for a recurring job how often
it comes round. Dates are calendar days, not instants — a certificate expires
on a date, and the reader's timezone should not decide whether it is overdue.

- The worker announces what has come due as a `document.due` webhook, once per
  date (`notified_for`). `/api/internal/webhooks` does the same pass for
  deployments with no timer, which is how a Worker deployment gets them at all.
- Marking a recurring job done steps from the date that *was* due, catching up
  in whole intervals if it was missed for months, so lateness never compounds
  and no pile of missed dates is left behind (`src/server/schedules/due.ts`).

## Administration
Admin is its own route group with a secondary rail, not a section of the
primary one: the primary rail is the documentation, which is what people come
for. `instance_settings` is a single row holding what an operator chooses once
— today the default locale, which sits between the reader's cookie and
`APP_LOCALE`. Webhooks live under Notifications, since that is the job they do;
`/admin/webhooks` redirects there. Admin → Portal is the public knowledge
base's setup page: what is set, whether the published address answers (tried
from the server the safe way), whether an Access token has verified since
the process started (`accessLastVerifiedAt`, held in memory on purpose),
which collections are on the site and to whom they are kept, which
companies place their people, and the branding it carries, with the
Cloudflare steps inline and the public-site form beneath.

### Doc type icons
`doc_types.icon` holds a lucide name as the lucide site spells it
(`globe-lock`). The admin form picks one from every icon lucide-react ships
(`src/components/ui/icon-picker.tsx`, loaded only with that form, since the
whole set rides with it) and the service refines the value to that shape.
`DocTypeIcon` (`src/components/doc-type-icon.tsx`) resolves a name to the
component by a key both spellings share (`src/lib/icon-name.ts`), so
`arrow-down-a-z` and `ArrowDownAZ` meet, and falls back to a plain document.
It is shown beside the type's name on the company page, the document and edit
pages, and the admin list.

## Branding
- `instance_branding` holds one row: a portal name, an accent color, and a logo
  key. `companies.accent` / `companies.logo_key` hold the same per client.
- The name replaces the product name in the top bar, the tab title, and the
  sign-in page.
- The product mark (`src/lib/trove-mark.ts`, a gem in six facets) stands in
  the header when there is no logo, as inline SVG in `var(--primary)`, so it
  is in the accent of the mode in force. The tab icon is always the mark on
  a tile in the accent, logo or not, from `/api/branding/icon`: SVG, or PNG
  with `format=png&size=N` (a 32px PNG is listed first for browsers that
  will not take an SVG, the SVG last so the others prefer it; the touch icon
  is 180px). The gem is cut in the accent's text color. When the two modes'
  colors differ the SVG carries a `prefers-color-scheme: dark` style block
  switching to the dark ones — the one way a favicon can follow the reader's
  mode; `mode=light|dark` pins one, for the previews on the branding page,
  and a PNG is always one mode. The address carries the colors (`?v=`, from
  `src/lib/brand-icon.ts`), so it caches hard and changes with the accent.
  The default palette is a teal (`globals.css`, hex twins in `trove-mark.ts`).
- An operator may upload a tab icon per mode instead (`icon_key` /
  `alt_icon_key`, PNG/JPEG/WebP/ICO sniffed, SVG refused as for logos). One
  stands in for both modes; two different ones make `/api/branding/icon` an
  SVG wrapping both as `data:` images under the same media query, with
  `mode=` serving the raster itself for the first link, the touch icon, and
  the previews. `iconPlan()` in `brand-icon.ts` decides which links the head
  lists.
- The footer credit ("Powered by Trove KB | Hearne Technologies") names the
  product and its maker, is the same on every install, and is optional:
  `instance_branding.show_powered_by`, on by default. The AGPL notice and the
  source link beside it are not optional, since §13 asks for them. On the
  public knowledge base alone, an operator may put their own name on the
  credit (`kb_powered_by_name`): "Powered by Trove KB | <name>" beside the
  instance logo, in front of their customers; the product stays named and
  the license stays put. A visitor placed with a company by their address
  sees that company's logo in the corner before the knowledge base's name,
  served by `/pub/kb/company-logo` to that visitor alone.
- A logo is stored under a key we generate and served back with the type
  sniffed from its own bytes. PNG, JPEG, and WebP only: an SVG is a document
  that can carry script, and a logo is drawn on every page including sign-in.
- The instance logo is served without authentication, because the sign-in page
  needs it. A company logo is not: it answers 404 outside the caller's company
  scope, like everything else about that company.
- Branding states which mode it was drawn for (`scheme`), and may carry a
  second logo and a second color for the other mode.
- A color stated for a mode is used in that mode **exactly as given**: an
  operator saying "this is our dark blue for dark mode" means it. The mode
  nobody stated is derived from the one they did, moved far enough from that
  surface to clear WCAG AA (`src/lib/brand-color.ts`). Only hex values reach a
  stylesheet, never the string that was typed. The accent is a fill with its
  label color computed against it, never text on the page background, so an
  exact brand color cannot make anything unreadable.
- Both logos are rendered and CSS shows one, keyed on the theme, so the right
  one is there in the first paint and keeps up when a reader's machine turns
  dark at sunset. With one logo, it is shown in both.
- The palette aliases are declared for `:root` **and any element with
  `data-theme`**, because `light-dark()` resolves where the declaration sits
  and a custom property inherits already resolved. That is what lets the
  branding screen render both themes side by side for real rather than
  illustrating them.
- A company's accent applies to its own pages and documents; the shell keeps
  the instance's, so it stays obvious which portal you are in.
- A revealed secret (vault password, TOTP, recovery codes, a new API key or
  webhook secret) is shown one `<span>` per character, marked by what it is,
  and colored by `data-secret-style` on `<html>`: `on` (letters blue, digits
  orange, symbols violet, AlphabetSoup's hues), `colorblind` (Paul Tol's
  vibrant set) or `off`. The choice is `users.secret_style`, on by default,
  picked from the user menu and carried on the application shell rather than
  `<html>` because it is the signed-in person's, not the browser's. Only
  administrators and technicians, who are who reveal secrets, see the choice;
  a read-only viewer gets no attribute and no select. The element's text
  content is still exactly the secret. The NATO readback ("Capital P as in Papa | 4 | ! as in
  Exclamation") sits beside the secret, never inside it, and is built in
  `src/lib/secret-text.ts`, a port of AlphabetSoup's core tables.

## Attachments
- What a file is comes from its own bytes, never from the browser's declared
  type or the extension (`src/server/uploads/accept.ts`).
- Images: PNG, JPEG, GIF, WebP, AVIF. HEIC and HEIF are converted to JPEG on
  the way in and stored with a `.jpg` name, because phones produce them and
  almost nothing else draws them.
- Documents: PDF, the OOXML formats (docx/xlsx/pptx), CSV, Markdown, plain
  text. Text has no signature, so the extension proposes and the bytes confirm.
- Refused: macro-enabled Office (any OOXML containing `vbaProject.bin`,
  whatever it is named), legacy OLE2 Office, plain zips, and everything else.
- The HEIC decoder is imported through a runtime specifier so the Worker bundle
  does not carry 8 MB of WebAssembly it may not execute. That hides it from
  dependency tracing, so `next.config.ts` names the whole chain; a unit test
  checks the two stay in step.
- On Workers, conversion is refused with a message rather than attempted:
  `WebAssembly.compile` is not allowed there.

## Shared lists versus links
A `doc_link` field points at a document, and a document belongs to one company.
That is right for "which circuit is this firewall on" and wrong for "who is the
registrar": an MSP would re-create Cloudflare for every client.

The rule the starter pack follows: if the answer is a *name* shared across
clients, it is a dropdown on an instance-wide option list. If it is a
*relationship* to that client's own record, it stays a `doc_link`. So Registrar,
DNS Host, and ISP Provider draw on shared lists, while Firewall → WAN still
links to that company's ISP document. An option list belongs to the doc type's
field, never to a company, and anyone editing a document can add to it inline.

## Domain checks
A record whose doc type marks a field as holding a domain can look that domain
up: DNS records, the TLS certificate, the registry's own registration record
over RDAP, and whether SPF, DMARC and DKIM are published.

- `fields.domain_role` is one of `domain`, `expiry`, `registrar`, `dns_host`.
  The feature is therefore not wired to one doc type's labels: point it at a
  field on a doc type of your own and it works there.
- Checks run when somebody asks, and the worker re-runs them on its own, each
  kind on its own clock. How often is a policy in three layers
  (`src/server/domain/policy.ts`): the instance says what everything follows
  (`instance_settings.domain_{dns,tls,rdap,email}_interval_days`, DNS and the
  certificate daily, registration and mail posture weekly, zero for never), a
  company may say otherwise for its records
  (`companies.domain_*_interval_days`, null to follow, zero to turn a kind off),
  and a record may say otherwise for itself (`domain_checks.*_interval_days`)
  or opt out of the worker altogether (`auto`). A new record states nothing,
  so it follows its company and, through it, the instance. Each kind keeps its
  own next time (`*_next_run_at`); `next_run_at` is the soonest, which is what
  the worker's query reads. A run replaces only the sections it fetched
  (`result.checked` says when each was), so the page shows every section at
  its own age and the summary compares like with like. The result is kept in
  `domain_checks`, so reading a page costs no lookups, and `checked_by` is null
  when the worker ran it.
- A certificate's warning is a notice in the same three layers
  (`domain_tls_warn_days`, 30 by default). A record may say its certificate
  renews on its own (`tls_auto_renews`): then its expiry is no cause for alarm
  and nothing is announced, unless the record also sets a notice, which means
  "warn me anyway". Registration keeps a fixed 60-day notice.
- A fifth kind, **website branding**, reads the site's front page the way
  the knowledge base crawler reads a page (`src/server/kb/fetch.ts`: every
  hop resolved, private addresses refused, the vetted address connected to)
  and keeps its title, theme color, icons and manifest
  (`src/server/domain/brand.ts`). It also reads the page's body for the logo
  the site actually shows — an `<img>` named `logo.*` or after the site's
  own hostname label, described as a logo by alt/class/id, or sitting in the
  link home — and a mark drawn inline as `<svg>` the same way (kept in the
  result, bounded at 64 KB, rendered when applied); those rank ahead of
  every head icon, which is how a favicon or a hero picture stops being the
  pick. The colors the site paints with come from its inline CSS and up to
  four linked stylesheets (`src/server/domain/palette.ts`): each color
  literal weighted by where it is used (a `--primary`/`--brand` custom
  property most, fills and backgrounds some, shadows not at all), greys,
  white and black left out unless they are all there is, the browser's own
  link colors left out always, near-shades folded; the top six follow the
  declared theme color. Nothing is applied by itself: the company's
  edit page lists every domain record's findings and an administrator picks
  one, whose icon becomes the logo (fetched the same safe way, sniffed, PNG,
  JPEG or WebP, or an SVG rendered to PNG by sharp with its transparency kept
  (`src/server/domain/svg.ts`), 1 MB; never on Workers, which run no native
  code) and whose color the accent
  (`src/server/services/company-brand.ts`). With several websites the record
  chosen is remembered (`companies.brand_domain_document_id`). Icons are
  drawn through the record's own route, never hotlinked from a client's site.
- Mail posture is shown as a table: the check, what was found, and the
  record itself. A DKIM key lives under a selector that cannot be listed, so
  the common selectors are tried and a record may name its own
  (`domain_checks.dkim_selectors`); without that, a domain signing under its
  own selector reads as having no key.
- TXT records are listed one per line with what each is for named where it
  can be told (`src/server/domain/txt.ts`: SPF, DMARC, DKIM, and the
  verification tokens of Google, Atlassian, Microsoft 365 and others). DMARC
  hosted elsewhere by CNAME (Proofpoint and the like) is read through it and
  the page says where it points.
- Each run boils the result down to a summary (`src/server/domain/summary.ts`:
  name servers, addresses, mail exchangers, certificate and its expiry,
  registrar, registration expiry, transfer lock, SPF, DMARC, DKIM) and compares
  it with the last one. A difference is a `domain.changed` webhook naming each
  change; only facts known on both sides are compared, so a section turned on
  or a lookup that failed once is not a change. A certificate or registration
  inside its warning window is a `domain.expiring` webhook, once per expiry
  date (`warned`). Admin → Notifications lists what the last run of every
  record flagged, the same facts the webhooks carry.
- The worker's pass (`runDueDomainChecks`) takes what is due oldest first,
  within the same budget a person's clicks share, runs only the kinds whose
  time has come, and puts off a record whose domain is empty or malformed
  until next time with the reason in `auto_error`. A record with nothing left
  to run is looked at again tomorrow. `/api/internal/webhooks` runs the same
  pass for deployments with no timer.
- Running one needs the document-editing permission, because it is outbound
  traffic sent on the instance's behalf, and the whole instance shares one
  budget of 30 runs a minute.
- **The domain is user input, so a lookup is an SSRF vector.** Names resolve
  first, anything that is not a public address is dropped, and the TLS
  connection is made to the vetted address with the name presented for SNI —
  which also closes DNS rebinding. See `src/server/domain/addresses.ts`.
- A finding never edits the record on its own. RDAP's registrar and expiry and
  the NS answer are offered beside the field, and accepting one is an ordinary
  save with a revision and an audit entry. A name that is not yet in a shared
  dropdown is added to it rather than refused, and an existing option wins even
  when the wording differs, so "GoDaddy.com, LLC" fills in the "GoDaddy"
  already on the list.
- DNS and TLS need Node, so on Workers those sections report that they are
  unavailable rather than failing. RDAP is plain HTTPS and works anywhere.

## Rack elevations
A doc type marked `is_rack` gives its documents an elevation: a size, whether
the rear is used, and what is mounted where.

- `racks` holds the size and the **numbering direction**. Rails are numbered
  from the bottom in most rooms and the top in some, so each rack says which it
  is rather than the software deciding; the drawing follows the rack.
- `rack_mounts` holds one row per thing: a document when it is written up, a
  plain label when it never will be (a patch panel, a shelf), its lowest unit,
  its height, and which face.
- Color comes from the kind of thing, not the thing: `rack_type_colors` with
  no company is the MSP default, with one it is that client's override. The
  client wins, then the MSP, then a built-in palette whose every pair is far
  enough apart to tell apart in print.
- "Too close" is measured perceptually in Oklab, not by comparing hex digits,
  because two different numbers can be the same color to a reader
  (`src/server/racks/colors.ts`). Three things are warned about: colors a
  reader could not distinguish, an override that has landed on a color already
  in use here — where the fix is to move the override, which nobody would think
  to look for — and two things claiming the same unit.
- The drawing is SVG, generated from a pure function and served as a file, so
  the page, the print, and the download are the same picture. Every label is
  escaped and a color that does not parse is drawn gray rather than written
  into the file. The URL carries a signature of what the rack contains, or a
  browser would keep showing the rack as it was.

## Knowledge base
Reference material from outside — a vendor's published KB, a folder of guides —
held in collections of its own, one per source. It is not documentation: an
article has no doc type, no fields, no revisions, and no company, and it never
appears in the documentation search.

- **Import** takes a zip, a folder, or loose files. The browser packs anything
  that is not already a zip, so the server unpacks one kind of thing. The
  archive goes up in 8 MB pieces, each naming its offset, because a tunnel or
  proxy caps one request far below the size of a knowledge base; a piece sent
  twice is harmless and a dropped upload resumes. The archive is read from
  scratch space as a stream and never written back out.
- **What a file is comes from its bytes**, by the attachment rules
  (`src/server/uploads/accept.ts`). Markdown keeps its YAML frontmatter as
  metadata; text is stored as it is; a PDF gives up its text layer only; a Word
  document becomes Markdown. A PDF with no text layer is stored and marked
  `unextracted` rather than failing the import. The package's own notes
  (`README.md`, `index.md`, `manifest.json`) are counted as not articles.
- **Pictures** in an archive are kept (`kb_images`), under the path they had
  in it, because that path is how the articles beside them name them. The
  formats are the attachment's: PNG, JPEG, GIF, WebP, AVIF, and HEIC converted
  to JPEG; a file named `.jpg` that is not one is passed over. Each is held to
  `MAX_UPLOAD_MB`, stored under a key of ours made from its hash, and skipped
  on a later import when its hash has not changed. Pictures and articles must
  arrive in the same archive, or the paths between them mean nothing.
- **An article's body is stored as it came.** When it is drawn, each reference
  to a path inside the import is resolved from the article's own path and
  pointed at the picture kept there (`src/server/kb/images.ts`). Exports write
  destinations a Markdown parser will not read — spaces, brackets — so the
  references are read before the parser sees them. Case is forgiven. A picture
  that did not come with the import leaves its caption. References to other
  sites are left alone. MCP returns the body as stored.
- **A picture is read through an article**, never on its own:
  `/api/kb/articles/:article/images/:image` signed in, and
  `/pub/kb/articles/:article/images/:image` on the public site. It is found
  only when the reader may read that article and the article refers to that
  picture, so an article held back from the public site takes its pictures
  with it. It is served with `nosniff` and a sandboxing policy, like any
  upload, and counted apart from pages by the public site's limiter.
- **Where an article lands**: its frontmatter's category first, then its
  folders inside the archive, then the archive's top folder, which an
  earlier version threw away; a category given with the import replaces all
  of that and demotes what the path said to the section. A collection that
  holds documents (PDF, Word) beside articles offers the kinds as a filter
  above its categories.
- **Upsert** is on `(collection_id, source_key)`. The key is `id:<external_id>`
  when the source names one and `path:<file path>` when it does not, so the two
  cannot collide and a re-import updates instead of duplicating. An article
  missing from a later import is left alone: absence from one export is not
  proof of deletion.
- **Incremental refresh**: with a `manifest.json`, an article whose
  `date_modified` matches what is stored is skipped without opening its file.
  Without one, the file's SHA-256 decides. The manifest's timestamp is kept in
  preference to the frontmatter's, which is often only the day.
- **Every run is recorded** in `kb_imports` with added, updated, skipped, and
  failed, plus how many had no readable text and how many were not articles.
  One bad file never fails a run. A run lives in the app process, so one
  interrupted by a restart is marked failed at the next boot.
- **Chunks**: an article is cut along its headings, then its paragraphs, into
  pieces of about 1,600 characters and never more than 2,400
  (`src/server/kb/chunk.ts`). Text inside a code fence is split too, because
  that is where the pages of an attached PDF arrive. Each chunk records the
  headings it sits under.
- **Search** is Postgres full-text over `kb_chunks.search_vec`, with the title
  weighted above headings above body, and one hit per article: its best chunk.
  There is no vector search. The database is stock Postgres with no pgvector,
  and adding an embedding service would break "no required external services".
- **Connectors** (`kb_connectors`) read a public site on a schedule, from its
  sitemap, by following links beneath a URL prefix, or through the structure
  a help center publishes (`src/server/kb/helpcenter.ts`: categories hold
  sections hold articles, read from the Zendesk-style
  `/api/v2/help_center/<locale>/` lists, so an article arrives under its
  category and section with its own id and dates; an article a crawl brought
  in earlier is adopted by the id in its address rather than added beside
  itself), and feed the same upsert. A sitemap or prefix crawl reads the
  whole site before it writes anything (`src/server/kb/crawl-structure.ts`):
  a page is keyed by the address it names as its own, so one article reached
  with and without its slug is one article; click-through and tracking
  addresses are not followed; a page that is mostly links to other pages is
  the site's structure and not an article; and every article is placed by
  its breadcrumbs, or failing those by the listing pages that lead to it,
  the nearer listing naming the section and the one above it the category.
  The page the crawl started from names nothing.
- **Where a collection came from** (`kb_collections.site_url`, or its first
  connector's address when unset) is offered to readers on the collection
  and on its card, for what sits behind the source's own sign-in.
- **The file behind a document** (a PDF, a Word file) is kept in storage beside
  the article made from it, noted on the article as `metadata.original`, and
  served through the article at `/api/kb/articles/:id/original` and on the
  public site, inline for a PDF, since what a document looks like is often
  the point and its text alone does not show it. A document imported before
  this whose file was not kept is taken in again on the next import of the
  same file, hash unchanged or not.
  Public pages only: no credentials, no cookies, `robots.txt` honoured, a pause
  between requests, a page cap per run. **Every address is user input or
  written by a stranger**, so each request and each redirect resolves first,
  refuses non-public addresses, and connects to the address it checked
  (`src/server/kb/fetch.ts`). A sitemap may only list its own site.
- **Access**: a collection belongs to no company, but it may be kept to some
  (`kb_collection_companies`). Kept to none, it is for every company, which is
  how a new one starts. Kept to some, it is read only by a person or API key
  with access to at least one of them; administrators, and anyone who sees
  every company, see every collection. Somebody with access to no company at
  all sees none. `mcp_enabled` switches a collection off for MCP alone, and MCP
  carries no tool that changes documentation. Out of reach reads as not found.
- **Grants** (`api_key_kb_collections`): an API key may be given a collection
  by name, to read or to read and write. These are the ordinary API keys; a
  key made with no companies is for the knowledge base alone and reads no
  documentation. A grant reads its collection whatever companies the
  collection is kept to. Grants are read on every request, so changing one
  applies to the key's next call.
- **Writing through MCP** is how an application's own tooling keeps its
  documentation current without anybody asking each time. A key is offered
  `upsert_kb_article` and `archive_kb_article` only when it holds a grant that
  writes, and they work only on the collections granted. An article is matched
  on the `external_id` its author chose, so a rewrite replaces. Nothing is
  deleted: an article that no longer applies is archived, and writing it again
  restores it. Every change is an audit entry naming the key. What is written
  is Markdown, sanitized when drawn, like everything else.
- **Customers on the public site**: when Cloudflare Access names a visitor
  (below), the domain of their address is looked up in
  `company_sign_in_domains`, set on the company's edit page, and the visitor
  reads as that company's people would: collections for every company, and
  those kept to theirs. A collection kept to a company is on the public site
  only for visitors placed with it; a visitor nobody named sees what is for
  every company alone. A domain places people with one company. No account is
  made and nothing of the visitor is stored; the address is read, matched,
  and dropped (`src/server/services/company-domains.ts`, `publicReader` in
  `src/server/kb/public.ts`).
- **The public site** (`/pub/kb`) is the knowledge base for readers who have
  not signed in. Nothing is on it by default, twice over: the site itself is
  off until an operator turns it on (`instance_settings.kb_public_mode`), and
  a collection is on it only when marked (`kb_collections.public_access`). A
  single article can be held back (`kb_articles.public_hidden`). It can be
  open to anyone, or to visitors from listed addresses and ranges, which is
  how "anyone on site" is said. The visitor's address is the one the proxy in
  front reports; the app must not be reachable except through that proxy.
  Once a published address is set (`kb_public_url`), the site answers only
  on that hostname: the same pages on the installation's own hostname would
  be the knowledge base without whatever gate the public hostname carries.
  A visitor who is not admitted gets "not found". The site links nowhere into
  the rest of the installation, asks not to be indexed, and is meant to be
  published on a hostname of its own whose proxy passes `/pub/kb` and the
  static assets and nothing else. See docs/CLOUDFLARE.md.
- **Readers on the public site** may keep favorites and vote an article
  helpful or not (`kb_favorites`, `kb_votes`) when Cloudflare Access is in
  front of the site and named in the settings (`kb_public_access_team`,
  `kb_public_access_aud`). Access puts a signed token naming the visitor on
  every request; it is checked against the team's published keys
  (`src/server/kb/identity.ts`), and the reader is then known only by a hash
  of their address and `AUTH_SECRET`. No account is made here, nothing is
  administered, and a dump of those rows names nobody. Without Access, or
  without a token, the site reads the same and offers nothing of the reader's
  own. Every reaction takes the public `KbReader` too: nobody reacts to an
  article they could not open.
- **Readers named by an integration**: a key with the `reactions` scope acts
  for a reader by naming their email in `X-Trove-Reader`; the key derives the
  same `readerKey(email)` the public site uses for a reader Cloudflare Access
  names, so favorites and votes are one set wherever they were made. The email
  is read, hashed, and dropped. `audience=public` on any API read puts the
  public site's predicate on top of the key's grants, so an integration can
  show what the site would.
- **Ordering and lists**: collections and articles sort by name, last change
  (the source's date, or arrival where the source gave none), article count,
  favorites, and helpfulness, which is the share of votes in favor, 0 to 100,
  null until somebody votes. The choice rides in the address and is remembered
  per browser in `localStorage`, which is the right place for a preference and
  the wrong place for anything shared. The public home page ends with the
  reader's favorites, the five most helpful pages (share, then number of votes,
  so one thumbs-up does not outrank a hundred), and the ten changed last.
- **Runbooks**: an article whose body is a procedure, `kb_articles.kind =
  'runbook'`. It stays an article, so collections, categories, the public site,
  search, import and upsert all work unchanged. Its `steps` (jsonb) are derived
  from the body on every save by `src/server/kb/runbook.ts`: the items of every
  top-level list that is a procedure, in order across headings: an ordered
  list, a task list, or a bullet list whose items carry ids (a bullet list
  without them is prose). Each step has a stable id written at the end of the
  item as `{#id}`, minted on first save (8 hex) when the author gave none and
  kept by matching the item's words on later saves. The page draws the body by
  turns, prose and checklist, with one count across them. What is
  nested under an item is its `note`; an `@canned:[Name]` token is surfaced as
  `canned`. A duplicate id is refused: the editor says so, the API answers 400,
  an import records the file as failed. Progress through a runbook is never
  stored here; a ticketing system that links one keeps its own, keyed by step
  id. The page draws the steps as a checklist that forgets on reload. `kind`
  comes from frontmatter, the MCP and REST upserts, or the in-app editor, and
  filters `list_kb_articles` and `search_kb`.
- **Grants to keys, at once**: a key's grant row carries `can_read`,
  `can_write`, and `reactions` (on by default), and Admin → Knowledge base →
  API access sets every collection for one key in one transaction with one
  audit entry listing the changes. A collection on the public site is open to
  every key as the public sees it, since it is open to the world; a grant adds
  what is held back, or writing. A revoked key may be deleted; the audit trail
  keeps its name.
- **Grants to people**: `user_kb_collections` has the shape of a key's grant,
  and `readable()` counts it the same way: a person reads a collection their
  companies give them, or one granted to them by name, and writes where the
  grant says so. Administrators need no grant. Grants are set under Admin →
  Knowledge base → the collection → People, or by an `admin`-scope key over
  REST, which can also make an account ahead of the person's first sign-in;
  single sign-on links to it by email.
- **Moving an article**: an administrator with the second step fresh can
  move an article to another collection from the editor. The article keeps
  its id, name, pictures (each copied to the new collection under the same
  stored file), and history; its chunks follow it, the new collection's hide
  rules apply on arrival, and the move is audited and announced as an upsert.
  The editor's category and section are dropdowns of what the collection
  already uses, with "New…" to type a fresh one; after a move they refresh to
  the new collection's, and anyone who may edit sets them.
- **Writing in the app**: administrators, and people granted write, get a Markdown editor at
  `/kb/articles/new?collection=` and `/kb/articles/:id/edit`, the same
  `writeArticle` service a key uses, with a `KbWriter` that names the person.
  An article is editable only under an `external_id` of its own; one brought
  in from a file or website is overwritten by its next import.
- Imports and connectors need a filesystem and raw sockets, so on Workers they
  report that they are unavailable. Reading and search work anywhere.

## Accounts and second factors
Trove KB has accounts of its own, so it has a second step of its own: single
sign-on in front of it, or Cloudflare Access, is not a substitute.

- **Passwords** (`src/server/auth/password-policy.ts`): 8 to 128 characters
  with an uppercase letter, a lowercase letter, a number, and a symbol or
  space; any printable Unicode; never the person's own name or address. The
  form lists the rules and ticks each as it is met. A password is then asked
  of the Pwned Passwords range service by k-anonymity (five characters of its
  SHA-1 leave the server), and refused if it has been in a breach; the service
  being away is not a refusal. Argon2id, as before. Nothing expires on a
  timer: a password is replaced when an administrator sets a temporary one
  (`users.must_change_password`, and nothing else opens until it is changed)
  or when the person chooses to, and every other session ends when it is.
  A reset by mail (`SMTP_URL`, `MAIL_FROM`) is a single-use link good for an
  hour, judged by the same policy; without mail, a temporary password from an
  administrator is the way back in.
- **Guessing**: ten wrong passwords in a row close the account for fifteen
  minutes (`users.failed_sign_ins`, `locked_until`), through Better Auth's
  before/after hooks on sign-in. A closed account answers exactly as a wrong
  password does. Every failure and every closing is an audit entry; an
  administrator opens an account again from the users page.
- **Second factors** (`src/server/services/mfa.ts`): an authenticator app
  (RFC 6238, thirty-second steps, one step of drift either way, the last
  accepted step kept so a code is never accepted twice), any number of
  passkeys (WebAuthn through `@simplewebauthn`, security keys and platform
  or password-manager passkeys alike, each named by its owner and revocable on
  its own, with its public key and sign counter), and ten single-use recovery
  codes, hashed, shown once when the first factor is enrolled and whenever a
  new set is made. The app's seed is sealed with AES-256-GCM under a key
  derived from `AUTH_SECRET` for that purpose alone
  (`src/server/auth/secret-box.ts`).
- **Who must**: administrators. One who has enrolled nothing gets a week from
  the first time the question is asked (`users.mfa_deadline`), then nothing
  but the enrollment page opens. Everyone else is offered it. An
  administrator cannot remove their last factor.
- **Sessions**: passing the step stamps the session
  (`sessions.mfa_verified_at`). `requireUser` sends a session that has a
  factor and no stamp to `/mfa`; the pages that issue keys, change people,
  or change security settings call `requireRecentMfa`, which asks again when
  the stamp is older than fifteen minutes. The pages where sign-in is
  finished (`/mfa`, `/account`) sit outside the gated layout and use
  `requireSession`.
- **Guessing the step**: five attempts a minute per person, and ten wrong in
  a row close the step for fifteen minutes (`users.mfa_failures`,
  `mfa_locked_until`); every wrong answer is an audit entry.
- **Recovery**: an administrator resets somebody's second step from the users
  page, which removes everything enrolled, unstamps their sessions, and
  starts their week again, audited. Nothing is done by hand in the database.
- **API keys** are not accounts and have no second step; they are scoped,
  rotated, and revoked instead.

## Security baseline
- Argon2id for local passwords
- API keys: random 32 bytes, shown once, stored as SHA-256 hash, looked up by prefix
- Webhooks signed with HMAC-SHA256 in `X-Trove-Signature`
- Server-side HTML sanitization for richtext (DOMPurify via jsdom or sanitize-html)
- CSRF protection on session routes, rate limiting on auth and API
