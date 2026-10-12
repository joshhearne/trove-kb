# API v1

Base: `/api/v1`. JSON. Auth: `Authorization: Bearer <api_key>`. The key is also
accepted on its own, as `Authorization: <api_key>` or `X-API-Key: <api_key>`.
Spec generated from Zod schemas and served at `/api/v1/openapi.json`.
Cursor pagination: `?limit=50&cursor=...`, response has `next_cursor`.

## Resources
```
GET    /companies                  ?q=&external_system=&external_id=
POST   /companies
GET    /companies/:id
PATCH  /companies/:id
GET    /companies/:id/locations
GET    /companies/:id/documents    ?doc_type=&location_id=

POST   /locations
GET    /locations/:id
PATCH  /locations/:id

GET    /doc-types                  (includes template fields)
GET    /doc-types/:id

GET    /documents/:id              (resolved values + raw IDs)
POST   /documents
PATCH  /documents/:id              (partial field_values merge)
GET    /documents/:id/revisions

GET    /option-lists/:id/items
POST   /option-lists/:id/items

GET    /search                     ?q=&company_id=&doc_type=
```

## Field values
Values are keyed by field UUID. Network types are normalized on write and come
back in that form in `value`:
- `ip`: `"10.0.0.5/24"`; send `"10.0.0.5"` for a single address (stored as `/32`,
  or `/128` for IPv6). A dotted mask is accepted: `"10.0.0.5 255.255.255.0"`.
- `ip_list`: `["8.8.8.8/32", "1.1.1.1/32"]`, in order; each entry as `ip` takes it.
  A single string is split on commas, spaces, and new lines.
- `network`: `"10.0.0.0/24"`; a prefix is required, and host bits are cleared.
- `ip_range`: `"192.168.1.100-192.168.1.199"`.
- `mac`: any common spelling; stored in the field's format (`mac_format` on the
  field, else the instance's). `resolved` shows it in the format in force now.
- `vlan`: a number from 1 to 4094. `hostname`: lowercased.
- `port`: `"443/tcp"`, `"53/tcp+udp"`, or `"8443"` with no protocol. A number,
  `"tcp 443"`, or a service name such as `"https"` is accepted.
- `port_range`: `"5060-5080/udp"`; a range of one port is stored as that port.
- `port_list`: `["80/tcp", "443/tcp", "5060-5080/udp"]`, in order; each entry as
  `port_range` takes it. A single string is split on commas, semicolons, new lines,
  and spaces, keeping a protocol with its number.
- `asn`: a number from 1 to 4294967294; `"AS13335"` and asdot `"1.10"` are accepted.
  `resolved` is `"AS13335"`.

## Company scope
A key is created with either every company or a named set. Everything below is
filtered by it: lists omit what the key may not see, and a single record it may
not see answers `404 not_found` — the same answer a missing id gets, so a key
cannot be used to find out which companies exist. `POST /companies` with a
restricted key answers `403 forbidden`, since the key could not see what it
created.

## PSA integration endpoints
The main use case: a ticket in any PSA needs to show that client's docs.
```
PUT    /external-refs              { entity, entity_id, system, external_id }  (upsert)
GET    /lookup                     ?system=halopsa&entity=company&external_id=123
                                   -> the company plus its locations and documents summary
```
Also support deep links a PSA can embed without the API:
`/go/{system}/company/{external_id}` redirects to the matching company page.

## Vault (requires `secrets:reveal` scope, off by default)
```
GET    /vault/items                ?company_id=&q=      (metadata only, scoped to mapped collection)
POST   /vault/items/:item_id/reveal   { document_id, field_id }  -> { password }  (audited, no-store)
POST   /vault/items/:item_id/totp     { document_id, field_id }  -> { code, period_remaining }
```
Secrets never appear in document, revision, search, export, or webhook payloads.

## Knowledge base
The same reads MCP offers and the same writes a grant allows, as routes. A key
reads the collections its companies or its grants give it; `mcp_enabled` does
not apply here.
```
GET    /kb/collections?writable=true                       collections this key may read; writable keeps those it may write
GET    /kb/collections/:id?kind=                           one collection with its categories and counts
GET    /kb/search?q=&collection_id=&category=&kind=&limit=&cursor=
GET    /kb/articles?collection_id=&category=&subcategory=&kind=&updated_since=&sort=&dir=&limit=&cursor=
GET    /kb/articles/:id                                    full body, kind, steps (runbooks), external_id, source_url, public_url
PUT    /kb/collections/:id/articles/:external_id           upsert { title, body, category?, subcategory?, kind?, source_url?, internal_only? }  (write scope + write grant)
DELETE /kb/collections/:id/articles/:external_id           archive                                                                    (write scope + write grant)
```
A collection on the public site is readable by every key with no grant, as the
public sees it (articles held back stay out); a grant adds those, or writing.
Under Admin → Knowledge base → API access, an administrator sets one key's
access to every collection at once: D (only what its companies allow, the
default), R, RW, and whether the key may keep reactions there (on by default).

Grants, with the `admin` scope. A person granted a collection reads it, and
with `can_write` writes to it in the app, whatever companies it is kept to;
administrators need no grant. An account can be made ahead of a person's
first sign-in so the grant is waiting for them; they sign in through single
sign-on with the same email, or an administrator sets a temporary password.
```
GET    /users                                              every account
POST   /users                 { email, name, role?, all_companies? }   create, or return the existing account (200)
PUT    /kb/collections/:id/grants/users/:userId  { can_write? }        grant to a person
DELETE /kb/collections/:id/grants/users/:userId                        withdraw
PUT    /kb/collections/:id/grants/api-keys/:keyId { can_write?, reactions? }   grant to a key
DELETE /kb/collections/:id/grants/api-keys/:keyId                      withdraw
```
Every grant change is an audit entry naming the key that made it.

Every article item carries `kind`, `source_type` (`md`, `html`, `pdf`, `docx`,
`txt`: what it was made from), `public` (on the public site right now),
`favorites`, and `helpfulness` (0–100, null until somebody votes). A collection
carries `kinds: { article, runbook }` and `source_types: [{ source_type, articles }]`
for the articles the caller may read. `source_type=` filters a list or a search
and repeats: `?source_type=pdf&source_type=docx`.

`audience=public` on any knowledge base read narrows the key's view to what
the public site shows (collections on the site, articles not held back), on
top of the key's own grants, so an integration can show a person exactly what
they would see there. `audience=key` is the default.

### Favorites and votes for a named reader
Favorites and helpfulness votes are kept under a reader key derived from an
email, the same key the public site uses when Cloudflare Access names the
reader, so a favorite made through the API is the one the person sees on the
public site and the other way round. These routes need the `reactions` scope
(granted explicitly; `admin` implies it), the collection not closed to
reactions for this key (open by default; 403 when closed), and the header
`X-Trove-Reader: <email>`, which names the reader; the email is never stored.
No header → 400.
```
GET    /kb/articles/:id/reactions   -> { favorites, helpful_up, helpful_down, helpfulness, mine: { favorite, vote: "up"|"down"|null } }
PUT    /kb/articles/:id/favorite    -> 204          DELETE -> 204
PUT    /kb/articles/:id/vote        { helpful: true|false } -> 204     DELETE -> 204 (vote taken back)
GET    /kb/favorites?limit=&cursor= -> { data: [ article item + { favorited_at } ], next_cursor }
```
`GET /kb/articles/:id` with `X-Trove-Reader` adds `mine` to the article too,
under the `read` scope; the header is optional there.

`public_url` is the article's address on the public site when the site is on,
the collection is on it, and the article is not held back; otherwise null.
`internal_only` on a PUT holds the article back by hand (true) or puts it back
(false); left out, the article stays as it was. A PUT answers 201 when it
created the article and 200 when it replaced it; a runbook body with a repeated
step id answers 400.

## Webhooks
Events: `company.created|updated`, `location.created|updated`,
`document.created|updated|archived`, `field.promoted`, `document.due`,
`domain.changed` (`{ id, title, company_id, domain, checked_at, changes: [{ what, from, to, message }] }`,
when a domain check finds something different from the run before),
`domain.expiring` (`{ id, title, company_id, domain, checked_at, kind: "certificate"|"registration", expires_on, days_remaining }`; a certificate is announced inside the notice its record, company or instance sets, and never when the record says it renews itself without asking for a notice,
once per expiry date),
`kb.article.upserted|archived` (`{ collection_id, article_id, external_id, kind }`,
sent for writes through the API, MCP, or the in-app editor).

Payload:
```json
{ "event": "document.updated", "occurred_at": "...", "data": { ... resolved document ... } }
```
Headers: `X-Trove-Event`, `X-Trove-Delivery`, `X-Trove-Signature: sha256=<hmac>`.
Retries with exponential backoff, up to 8 attempts.

## MCP
`POST /api/mcp`, Streamable HTTP with JSON responses, authenticated by the same
API keys with the `read` scope:

| Tool | What it returns |
|---|---|
| `search_documents`, `get_document` | Documentation, secrets redacted |
| `list_companies`, `get_company`, `list_doc_types` | The hierarchy and the templates |
| `list_kb_collections` | Knowledge base collections; with `collection_id`, its categories |
| `search_kb` | One result per article: the passage that matched, and `source_url` |
| `get_kb_article` | An article in chunks; follow `next_chunk` for a long one. A runbook also carries `steps` |
| `list_kb_articles` | A collection's articles with their `external_id` and `kind`; `kind` filters |
| `upsert_kb_article` | Writes an article, replacing the one with the same `external_id`; `kind: "runbook"` makes a procedure |
| `archive_kb_article` | Takes an article out of the collection; nothing is deleted |

The last two are offered only to a key granted write on a collection, under
Admin → Knowledge base → the collection → API key access, and work only there.

A knowledge base collection kept to named companies is seen only by a key with
access to one of them, and no key sees a collection with MCP turned off.

### Runbooks
An article with `kind: "runbook"` is a procedure. Its `steps` are read from the
body on every save: the items of every top-level list that is a procedure, in
order across headings (a numbered list, a task list, or a bullet list whose
items carry ids), each as `{ id, text, note?, canned? }`. The `id` is stable: write it yourself at the end
of the item as `{#my-id}` (`[a-z0-9-]{1,40}`), or let Trove KB mint one on first
save, after which it is in the stored body and kept across edits. A system that
tracks progress through a runbook keys its state by `id` and keeps that state on
its own side; Trove KB stores none. `note` is whatever was nested under the item,
Markdown; `canned` is the name in the first `@canned:[Name]` token of the step.
Two steps with one id are refused.

## Knowledge base import (administrators, session-authenticated)
Used by Admin → Knowledge base. Not part of `/api/v1` and not reachable with an
API key.
```
POST   /api/kb/imports                { collectionId, filename, size } -> { id, pieceBytes }
PUT    /api/kb/imports/:id?offset=N   raw bytes of one piece           -> { received_bytes }
POST   /api/kb/imports/:id/complete                                    -> 202, import runs on
GET    /api/kb/imports/:id                                             -> status and counts, `images` among them
DELETE /api/kb/imports/:id            abandons an upload
```
A piece out of order answers `409` with the `received_bytes` to resume from.
An archive already on the server can be imported without the browser:
`npx tsx --conditions react-server scripts/kb-import.ts "<collection>" <file.zip>`.
Run it where `STORAGE_PATH` is the deployment's own uploads volume: the pictures
in the archive are written there.

A picture in an article is a session route, not part of the API:
`GET /api/kb/articles/:articleId/images/:imageId`, found only through an article
that shows it.
