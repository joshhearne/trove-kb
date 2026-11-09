import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { kbArticles, kbChunks, kbCollections, kbImportExclusions, kbImports } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { chunkText } from "@/server/kb/chunk";
import { tidyImportedMarkdown } from "@/server/kb/tidy";
import { deriveRunbook, RunbookStepError, type RunbookStep } from "@/server/kb/runbook";
import { applyVisibility } from "@/server/services/kb-visibility";
import {
  extractArticle,
  NotAnArticleError,
  type ExtractedArticle,
} from "@/server/kb/extract";
import {
  normalizePath,
  parseManifest,
  sameInstant,
  type Manifest,
} from "@/server/kb/manifest";
import { ArchiveError, commonRoot, MAX_ENTRY_BYTES, readArchive } from "@/server/kb/zip";
import { getStorage } from "@/server/storage";
import {
  acceptAttached,
  isAttachedPath,
  knownImages,
  MAX_IMAGE_BYTES,
  storeImage,
} from "@/server/services/kb-images";

/**
 * The importer. An upload and a connector both end here: each article is
 * upserted on (collection, source key), where the key is the source's own id
 * and, failing that, the file's path — so bringing the same source in again
 * updates what is there instead of adding to it. The pictures an archive
 * carries are kept beside them, under the paths the articles name them by.
 *
 * One bad file never fails a run. It is counted, named, and the run goes on.
 */

/** Files a package carries about itself. They describe the pile; they are not in it. */
const PACKAGE_NOTES = new Set(["readme.md", "index.md", "unextracted-documents.md"]);
const MAX_FAILURES = 200;
const PROGRESS_EVERY = 50;
const CHUNK_BATCH = 200;

export type ImportSummary = {
  total: number;
  added: number;
  updated: number;
  skipped: number;
  failed: number;
  unextracted: number;
  ignored: number;
  images: number;
  failures: { path: string; reason: string }[];
  usedManifest: boolean;
};

export type ImportRow = ImportSummary & {
  id: string;
  collectionId: string;
  source: string;
  filename: string | null;
  status: string;
  expectedBytes: number | null;
  receivedBytes: number;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  category: string | null;
};

type Known = {
  id: string;
  sourcePath: string | null;
  dateModified: Date | null;
  contentHash: string;
  archived: boolean;
  /** Whether the file it was made from is kept, for one that came as a document. */
  hasOriginal: boolean;
};

/**
 * The file an article was made from, kept as it came for a reader who wants
 * the document itself: a PDF's layout, a Word file's tables. Noted on the
 * article's metadata under `original`.
 */
export type OriginalFile = { key: string; mime: string; bytes: number; name: string };

const ORIGINAL_MIME: Partial<Record<string, string>> = {
  pdf: "application/pdf",
  // Served only as a download, sandboxed: never drawn as a page of this site.
  html: "text/html",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function originalOf(metadata: Record<string, unknown>): OriginalFile | null {
  const value = metadata.original;
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.key !== "string" || typeof record.mime !== "string") return null;
  return {
    key: record.key,
    mime: record.mime,
    bytes: typeof record.bytes === "number" ? record.bytes : 0,
    name: typeof record.name === "string" ? record.name : "document",
  };
}

/** Keeps the file beside the article it became, under a key made from its content. */
export async function keepOriginal(
  collectionId: string,
  path: string,
  bytes: Buffer,
  sourceType: string,
  contentHash: string,
): Promise<OriginalFile | null> {
  const mime = ORIGINAL_MIME[sourceType];
  if (!mime) return null;
  const key = `kb/${collectionId}/${contentHash}.${sourceType}`;
  const storage = await getStorage();
  await storage.put(key, bytes, mime);
  return { key, mime, bytes: bytes.byteLength, name: path.split("/").pop() || "document" };
}

export function sourceKey(externalId: string | null, path: string): string {
  return externalId ? `id:${externalId}` : `path:${path}`;
}

/** Postgres text cannot hold a NUL, and extracted PDF text sometimes has one. */
export function clean(text: string): string {
  return text.includes("\u0000") ? text.replaceAll("\u0000", "") : text;
}

type ChunkExecutor = Pick<typeof db, "insert" | "delete">;

/** Replaces an article's search chunks with ones cut from this text. */
export async function rewriteChunks(
  tx: ChunkExecutor,
  articleId: string,
  collectionId: string,
  title: string,
  body: string,
  extraction: string,
): Promise<void> {
  await tx.delete(kbChunks).where(eq(kbChunks.articleId, articleId));
  const chunks = extraction === "ok" ? chunkText(body) : [];
  for (let at = 0; at < chunks.length; at += CHUNK_BATCH) {
    await tx.insert(kbChunks).values(
      chunks.slice(at, at + CHUNK_BATCH).map((chunk) => ({
        articleId,
        collectionId,
        ordinal: chunk.ordinal,
        title,
        heading: chunk.heading.slice(0, 500),
        content: chunk.content,
      })),
    );
  }
}

/** What the manifest says about an article's attachments, for its metadata. */
function unextractedAttachments(metadata: Record<string, unknown>): string[] {
  const attachments = metadata.doc_attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter(
      (item): item is { name: string } =>
        typeof item === "object" && item !== null && "extracted" in item &&
        (item as { extracted: unknown }).extracted === false &&
        typeof (item as { name: unknown }).name === "string",
    )
    .map((item) => item.name);
}

/**
 * Writes one article and its chunks, replacing what was there under the same
 * key. Everything that adds to a collection ends here — an upload, a
 * connector, a tool call — so an article is chunked and indexed one way.
 */
/** The keys an import of this collection leaves alone (kb_import_exclusions). */
export async function excludedKeys(collectionId: string): Promise<Set<string>> {
  const rows = await db
    .select({ sourceKey: kbImportExclusions.sourceKey })
    .from(kbImportExclusions)
    .where(eq(kbImportExclusions.collectionId, collectionId));
  return new Set(rows.map((row) => row.sourceKey));
}

/**
 * Writes an article under its key. `writerPlaces` is for a writer that says
 * where the article goes (the editor, a key): what it says stands, and the
 * article stops counting as placed by hand. An import or a connector only
 * proposes a place, so one an administrator chose is kept.
 */
export async function storeArticle(
  collectionId: string,
  key: string,
  path: string | null,
  article: ExtractedArticle,
  contentHash: string,
  { writerPlaces = false }: { writerPlaces?: boolean } = {},
): Promise<string> {
  const title = clean(article.title).slice(0, 500) || "Untitled";
  let body = clean(article.body);
  const kind = article.kind ?? "article";

  // A runbook's steps come from its body, keeping the ids of the steps it had.
  let steps: RunbookStep[] = [];
  if (kind === "runbook" && article.format === "markdown") {
    const [known] = await db
      .select({ steps: kbArticles.steps })
      .from(kbArticles)
      .where(and(eq(kbArticles.collectionId, collectionId), eq(kbArticles.sourceKey, key)))
      .limit(1);
    const derived = deriveRunbook(body, known?.steps ?? []);
    body = derived.body;
    steps = derived.steps;
  }

  const values = {
    externalId: article.externalId,
    sourcePath: path,
    sourceUrl: article.sourceUrl,
    title,
    body,
    format: article.format,
    sourceType: article.sourceType,
    category: article.category,
    subcategory: article.subcategory,
    metadata: article.metadata,
    dateCreated: article.dateCreated,
    dateModified: article.dateModified,
    extraction: article.extraction,
    contentHash,
    kind,
    steps,
    // Said in the file, the public-site setting is taken; unsaid, it is left as it was.
    ...(article.publicHidden === undefined
      ? {}
      : { publicHidden: article.publicHidden, hiddenBy: article.publicHidden ? "manual" : null }),
  };

  const chunks = article.extraction === "ok" ? chunkText(body) : [];

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(kbArticles)
      .values({ collectionId, sourceKey: key, ...values })
      .onConflictDoUpdate({
        target: [kbArticles.collectionId, kbArticles.sourceKey],
        set: {
          ...values,
          ...(writerPlaces
            ? { placedManually: false }
            : {
                category: sql`case when ${kbArticles.placedManually} then ${kbArticles.category} else excluded.category end`,
                subcategory: sql`case when ${kbArticles.placedManually} then ${kbArticles.subcategory} else excluded.subcategory end`,
              }),
          archivedAt: null,
          updatedAt: new Date(),
        },
      })
      .returning({ id: kbArticles.id });
    if (!row) throw new Error("Upsert returned nothing");

    await tx.delete(kbChunks).where(eq(kbChunks.articleId, row.id));
    for (let at = 0; at < chunks.length; at += CHUNK_BATCH) {
      await tx.insert(kbChunks).values(
        chunks.slice(at, at + CHUNK_BATCH).map((chunk) => ({
          articleId: row.id,
          collectionId,
          ordinal: chunk.ordinal,
          title,
          heading: chunk.heading.slice(0, 500),
          content: chunk.content,
        })),
      );
    }

    // A rule or a hidden category applies to an article the moment it arrives.
    await applyVisibility(collectionId, row.id, tx);

    return row.id;
  });
}

export class ImportRun {
  readonly summary: ImportSummary = {
    total: 0,
    added: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    unextracted: 0,
    ignored: 0,
    images: 0,
    failures: [],
    usedManifest: false,
  };

  private byKey = new Map<string, Known>();
  private byPath = new Map<string, Known>();
  /** Pictures already held, by path, with the hash each arrived with. */
  private pictures = new Map<string, string>();
  /** Keys an administrator removed, moved away, or took over: the import leaves them alone. */
  private excluded = new Set<string>();
  private sinceProgress = 0;

  private constructor(
    readonly collectionId: string,
    readonly importId: string,
    private manifest: Manifest | null,
  ) {
    this.summary.usedManifest = manifest !== null;
  }

  /** Write every article again, changed or not: for when what is derived from a body has changed. */
  rewriteAll = false;

  static async begin(
    collectionId: string,
    importId: string,
    manifest: Manifest | null,
  ): Promise<ImportRun> {
    const run = new ImportRun(collectionId, importId, manifest);

    const rows = await db
      .select({
        id: kbArticles.id,
        sourceKey: kbArticles.sourceKey,
        sourcePath: kbArticles.sourcePath,
        dateModified: kbArticles.dateModified,
        contentHash: kbArticles.contentHash,
        archivedAt: kbArticles.archivedAt,
        hasOriginal: sql<boolean>`${kbArticles.metadata} ? 'original'`,
      })
      .from(kbArticles)
      .where(eq(kbArticles.collectionId, collectionId));

    for (const row of rows) {
      const known: Known = {
        id: row.id,
        sourcePath: row.sourcePath,
        dateModified: row.dateModified,
        contentHash: row.contentHash,
        archived: row.archivedAt !== null,
        hasOriginal: row.hasOriginal === true,
      };
      run.byKey.set(row.sourceKey, known);
      if (row.sourcePath) run.byPath.set(row.sourcePath, known);
    }

    run.pictures = await knownImages(collectionId);
    run.excluded = await excludedKeys(collectionId);

    await db
      .update(kbImports)
      .set({ status: "running", usedManifest: manifest !== null })
      .where(eq(kbImports.id, importId));

    return run;
  }

  /** Reads what the collection holds again, after rows were re-keyed under it. */
  async reload(): Promise<void> {
    this.byKey.clear();
    this.byPath.clear();
    const rows = await db
      .select({
        id: kbArticles.id,
        sourceKey: kbArticles.sourceKey,
        sourcePath: kbArticles.sourcePath,
        dateModified: kbArticles.dateModified,
        contentHash: kbArticles.contentHash,
        archivedAt: kbArticles.archivedAt,
        hasOriginal: sql<boolean>`${kbArticles.metadata} ? 'original'`,
      })
      .from(kbArticles)
      .where(eq(kbArticles.collectionId, this.collectionId));
    for (const row of rows) {
      const known: Known = {
        id: row.id,
        sourcePath: row.sourcePath,
        dateModified: row.dateModified,
        contentHash: row.contentHash,
        archived: row.archivedAt !== null,
        hasOriginal: row.hasOriginal === true,
      };
      this.byKey.set(row.sourceKey, known);
      if (row.sourcePath) this.byPath.set(row.sourcePath, known);
    }
  }

  /**
   * Whether the manifest already says this file has not changed, which saves
   * opening it. Only a path can answer that before the file is read.
   */
  unchangedByManifest(path: string): boolean {
    const entry = this.manifest?.byPath.get(path);
    const known = this.byPath.get(path);
    return !!entry && !!known && !known.archived && sameInstant(entry.dateModified, known.dateModified);
  }

  isPackageNote(path: string): boolean {
    if (path.includes("/")) return false;
    const name = path.toLowerCase();
    return name === "manifest.json" || PACKAGE_NOTES.has(name);
  }

  async skip(): Promise<void> {
    this.summary.total += 1;
    this.summary.skipped += 1;
    await this.progress();
  }

  /**
   * Moves an article that has not otherwise changed. A category given with
   * an import is a reason to bring the same files again, and the files being
   * the same must not stand in its way.
   */
  async place(
    path: string,
    externalId: string | null,
    category: string | null,
    subcategory: string | null,
  ): Promise<boolean> {
    const key = sourceKey(externalId, path);
    if (this.excluded.has(key)) return false;
    const known = this.byKey.get(key);
    if (!known || known.archived) return false;
    const [row] = await db
      .update(kbArticles)
      .set({ category, subcategory, updatedAt: new Date() })
      .where(
        and(
          eq(kbArticles.id, known.id),
          eq(kbArticles.placedManually, false),
          or(
            sql`${kbArticles.category} is distinct from ${category}`,
            sql`${kbArticles.subcategory} is distinct from ${subcategory}`,
          ),
        ),
      )
      .returning({ id: kbArticles.id });
    if (!row) return false;
    this.summary.total += 1;
    this.summary.updated += 1;
    await this.progress();
    return true;
  }

  async ignore(): Promise<void> {
    this.summary.ignored += 1;
  }

  /**
   * A file that is not an article. A picture is kept, under the path the
   * articles beside it use; anything else is passed over.
   */
  async other(path: string, bytes: Buffer): Promise<void> {
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    if (this.pictures.get(path) === contentHash) {
      this.summary.images += 1;
      return;
    }

    let accepted;
    try {
      accepted = await acceptAttached(path, bytes, isAttachedPath(path));
    } catch (error) {
      return this.fail(path, error instanceof Error ? error.message : "The image could not be read");
    }
    if (!accepted) return this.ignore();
    // A picture is held to what an attachment is; a document may be a manual.
    const most = accepted.category === "image" ? MAX_IMAGE_BYTES : MAX_ENTRY_BYTES;
    if (accepted.bytes.byteLength > most) {
      return this.fail(path, "The file is too large to import");
    }

    try {
      await storeImage(this.collectionId, path, contentHash, accepted);
      this.pictures.set(path, contentHash);
      this.summary.images += 1;
    } catch (error) {
      console.error(`trove-kb: knowledge base import could not store ${path}`, error);
      await this.fail(path, "The image could not be stored");
    }
  }

  async fail(path: string, reason: string): Promise<void> {
    this.summary.total += 1;
    this.summary.failed += 1;
    if (this.summary.failures.length < MAX_FAILURES) {
      this.summary.failures.push({ path, reason: reason.slice(0, 300) });
    }
    await this.progress();
  }

  /** Whether these bytes are what the collection already holds under this key, file kept and all. */
  unchanged(path: string, externalId: string | null, bytes: Buffer): boolean {
    const known = this.byKey.get(sourceKey(externalId, path));
    if (!known || known.archived) return false;
    const hash = createHash("sha256").update(bytes).digest("hex");
    return known.contentHash === hash && (known.hasOriginal || !(this.wantsOriginalFor(path)));
  }

  private wantsOriginalFor(path: string): boolean {
    const extension = path.split(".").pop()?.toLowerCase() ?? "";
    return extension in ORIGINAL_MIME;
  }

  /** One file from an archive or a folder. */
  async file(path: string, bytes: Buffer): Promise<void> {
    let article: ExtractedArticle;
    try {
      article = await extractArticle(path, bytes);
    } catch (error) {
      if (error instanceof NotAnArticleError) return this.other(path, bytes);
      return this.fail(path, "The file could not be read");
    }

    await this.document(path, article, bytes);
  }

  /**
   * An article made from a file, with the file itself kept beside it when
   * it was a document: what a PDF or a Word file looks like is often the
   * point, and the text alone does not show it.
   */
  async document(path: string, article: ExtractedArticle, bytes: Buffer): Promise<void> {
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    if (this.excluded.has(sourceKey(article.externalId, path))) return this.skip();
    if (!(article.sourceType in ORIGINAL_MIME)) return this.article(path, article, contentHash);

    const known = this.byKey.get(sourceKey(article.externalId, path));
    const unchanged = !!known && !known.archived && known.contentHash === contentHash;
    // An unchanged document is skipped as ever, unless its file was not kept
    // last time: that one is brought in again, for the file.
    if (unchanged && known.hasOriginal) return this.skip();
    await this.upsertWithOriginal(path, article, bytes, contentHash);
  }

  private async upsertWithOriginal(
    path: string,
    article: ExtractedArticle,
    bytes: Buffer,
    contentHash: string,
  ): Promise<void> {
    let original: OriginalFile | null = null;
    try {
      original = await keepOriginal(this.collectionId, path, bytes, article.sourceType, contentHash);
    } catch (error) {
      console.error(`trove-kb: knowledge base import could not keep the file ${path}`, error);
    }
    const withFile = original ? { ...article, metadata: { ...article.metadata, original } } : article;
    await this.article(path, withFile, contentHash, true);
  }

  /** One article, however it was come by. `force` writes it even when nothing changed. */
  async article(
    path: string,
    article: ExtractedArticle,
    contentHash: string,
    force = false,
  ): Promise<void> {
    const key = sourceKey(article.externalId, path);
    // Removed, moved elsewhere, or edited here by an administrator.
    if (this.excluded.has(key)) return this.skip();
    const known = this.byKey.get(key);

    // The manifest's date is the source's own, to the millisecond; the
    // frontmatter's is often only the day.
    const listed =
      (article.externalId ? this.manifest?.byId.get(article.externalId) : undefined) ??
      this.manifest?.byPath.get(path);
    const dateModified = listed?.dateModified ?? article.dateModified;

    if (known && !known.archived && !force && !this.rewriteAll) {
      const unchanged = listed
        ? sameInstant(listed.dateModified, known.dateModified)
        : known.contentHash === contentHash;
      if (unchanged) return this.skip();
    }

    try {
      const id = await this.upsert(key, path, { ...article, dateModified }, contentHash);
      this.summary.total += 1;
      if (known) this.summary.updated += 1;
      else this.summary.added += 1;
      if (
        article.extraction === "unextracted" ||
        unextractedAttachments(article.metadata).length > 0
      ) {
        this.summary.unextracted += 1;
      }

      const now: Known = {
        id,
        sourcePath: path,
        dateModified,
        contentHash,
        archived: false,
        hasOriginal: originalOf(article.metadata) !== null,
      };
      this.byKey.set(key, now);
      this.byPath.set(path, now);
      await this.progress();
    } catch (error) {
      if (error instanceof RunbookStepError) {
        await this.fail(path, error.message);
        return;
      }
      console.error(`trove-kb: knowledge base import could not store ${path}`, error);
      await this.fail(path, "The article could not be stored");
    }
  }

  private upsert(
    key: string,
    path: string,
    article: ExtractedArticle,
    contentHash: string,
  ): Promise<string> {
    // What was imported reads as its source did; the hash stays the source's.
    const body = article.format === "markdown" ? tidyImportedMarkdown(article.body) : article.body;
    return storeArticle(this.collectionId, key, path, { ...article, body }, contentHash);
  }

  private async progress(force = false): Promise<void> {
    this.sinceProgress += 1;
    if (!force && this.sinceProgress < PROGRESS_EVERY) return;
    this.sinceProgress = 0;

    const { failures, usedManifest, ...counts } = this.summary;
    await db
      .update(kbImports)
      .set({ ...counts, failures, usedManifest })
      .where(eq(kbImports.id, this.importId));
  }

  async finish(actorId: string | null, error?: string): Promise<ImportSummary> {
    const { failures, usedManifest, ...counts } = this.summary;

    await db.transaction(async (tx) => {
      await tx
        .update(kbImports)
        .set({
          ...counts,
          failures,
          usedManifest,
          status: error ? "failed" : "done",
          error: error ?? null,
          finishedAt: new Date(),
        })
        .where(eq(kbImports.id, this.importId));

      await writeAudit(
        {
          userId: actorId,
          action: error ? "kb_import.failed" : "kb_import.finished",
          entity: "kb_import",
          entityId: this.importId,
          detail: { collectionId: this.collectionId, ...counts, usedManifest },
        },
        tx,
      );
    });

    return this.summary;
  }
}

/** Merges what the manifest knows about attachments into an article's own. */
function withManifestAttachments(
  raw: string,
): Map<string, unknown> {
  const attachments = new Map<string, unknown>();
  try {
    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed)
      ? parsed
      : ((parsed as { articles?: unknown[] } | null)?.articles ?? []);
    for (const entry of list as Record<string, unknown>[]) {
      if (typeof entry !== "object" || entry === null) continue;
      if (typeof entry.path === "string" && Array.isArray(entry.doc_attachments)) {
        attachments.set(normalizePath(entry.path), entry.doc_attachments);
      }
    }
  } catch {
    // The manifest was already judged by parseManifest; this is only extra.
  }
  return attachments;
}

/**
 * Imports a zip archive from disk. Two passes: the first finds the manifest
 * and the folder everything sits under, the second reads the articles.
 */
export async function importArchive(options: {
  file: string;
  collectionId: string;
  importId: string;
  actorId: string | null;
  /** Given for the whole archive; the folder's own name is used without it. */
  category?: string | null;
  /**
   * Open every file and judge it by its content, even where the manifest
   * says it has not changed: for an export whose files changed shape without
   * their dates changing, such as one that gained its pictures.
   */
  ignoreManifest?: boolean;
  /** Write every article again, changed or not. */
  force?: boolean;
}): Promise<ImportSummary> {
  let run: ImportRun | null = null;

  try {
    let manifestText: string | null = null;
    const names = await readArchive(
      options.file,
      (path) => /(^|\/)manifest\.json$/i.test(path) && path.split("/").length <= 2,
      async (entry) => {
        if (entry.bytes) manifestText ??= entry.bytes.toString("utf8");
      },
    );

    const root = commonRoot(names);
    // The folder somebody picked is the category of what is in it, unless
    // they gave a better name for it, or an article names its own.
    const given = options.category?.trim() || null;
    const folder = root ? root.slice(0, -1) : null;
    const manifest = manifestText && !options.ignoreManifest ? parseManifest(manifestText) : null;
    const attachments = manifestText ? withManifestAttachments(manifestText) : new Map();
    const importing = await ImportRun.begin(options.collectionId, options.importId, manifest);
    importing.rewriteAll = options.force === true;
    run = importing;

    const relative = (path: string) => (root && path.startsWith(root) ? path.slice(root.length) : path);

    // Decided while the archive is being read, acted on once the entry is whole.
    const skipped: string[] = [];

    await readArchive(
      options.file,
      (full) => {
        const path = relative(full);
        if (importing.isPackageNote(path)) {
          void importing.ignore();
          return false;
        }
        if (importing.unchangedByManifest(path)) {
          skipped.push(path);
          return false;
        }
        return true;
      },
      async (entry) => {
        while (skipped.length > 0) {
          skipped.pop();
          await importing.skip();
        }

        const path = relative(entry.path);
        if (entry.tooLarge) return importing.fail(path, "The file is too large to import");
        if (!entry.bytes) return importing.fail(path, "The file could not be unpacked");

        // What sits in an images/ or files/ folder belongs to an article nearby.
        if (isAttachedPath(path)) return importing.other(path, entry.bytes);

        let article: ExtractedArticle;
        try {
          article = await extractArticle(path, entry.bytes);
        } catch (error) {
          if (error instanceof NotAnArticleError) return importing.other(path, entry.bytes);
          return importing.fail(path, "The file could not be read");
        }

        const listed = attachments.get(path);
        if (listed) article.metadata = { ...article.metadata, doc_attachments: listed };

        if (given) {
          // The name given here replaces whatever the path said; what the
          // path said becomes the section, if the article had none.
          article.subcategory = article.subcategory ?? article.category;
          article.category = given;
          // An article the files leave unchanged still moves to the name given.
          const unchanged = importing.unchanged(path, article.externalId, entry.bytes);
          if (unchanged) {
            if (!(await importing.place(path, article.externalId, article.category, article.subcategory))) {
              await importing.skip();
            }
            return;
          }
        } else if (!article.category && folder) {
          article.category = folder;
        }

        await importing.document(path, article, entry.bytes);
      },
    );

    while (skipped.length > 0) {
      skipped.pop();
      await importing.skip();
    }

    return await importing.finish(options.actorId);
  } catch (error) {
    const message =
      error instanceof ArchiveError ? error.message : "The import stopped unexpectedly";
    if (!(error instanceof ArchiveError)) {
      console.error("trove-kb: knowledge base import failed", error);
    }

    if (run) return run.finish(options.actorId, message);

    await db
      .update(kbImports)
      .set({ status: "failed", error: message, finishedAt: new Date() })
      .where(eq(kbImports.id, options.importId));
    throw error;
  }
}

/* ---------- Import records ---------- */

const importColumns = {
  id: kbImports.id,
  collectionId: kbImports.collectionId,
  source: kbImports.source,
  filename: kbImports.filename,
  status: kbImports.status,
  expectedBytes: kbImports.expectedBytes,
  receivedBytes: kbImports.receivedBytes,
  total: kbImports.total,
  added: kbImports.added,
  updated: kbImports.updated,
  skipped: kbImports.skipped,
  failed: kbImports.failed,
  unextracted: kbImports.unextracted,
  ignored: kbImports.ignored,
  images: kbImports.images,
  failures: kbImports.failures,
  usedManifest: kbImports.usedManifest,
  category: kbImports.category,
  error: kbImports.error,
  startedAt: kbImports.startedAt,
  finishedAt: kbImports.finishedAt,
};

export async function getImport(id: string): Promise<ImportRow | null> {
  const [row] = await db.select(importColumns).from(kbImports).where(eq(kbImports.id, id)).limit(1);
  return row ?? null;
}

export async function listImports(collectionId: string, limit = 10): Promise<ImportRow[]> {
  return db
    .select(importColumns)
    .from(kbImports)
    .where(eq(kbImports.collectionId, collectionId))
    .orderBy(desc(kbImports.startedAt))
    .limit(limit);
}

export async function createImportRecord(input: {
  collectionId: string;
  source: "upload" | "connector";
  filename?: string | null;
  expectedBytes?: number | null;
  connectorId?: string | null;
  actorId: string | null;
  status?: "uploading" | "running";
  category?: string | null;
}): Promise<string> {
  const [collection] = await db
    .select({ id: kbCollections.id })
    .from(kbCollections)
    .where(eq(kbCollections.id, input.collectionId))
    .limit(1);
  if (!collection) throw new Error("Collection not found");

  const [row] = await db
    .insert(kbImports)
    .values({
      collectionId: input.collectionId,
      source: input.source,
      filename: input.filename?.slice(0, 300) ?? null,
      expectedBytes: input.expectedBytes ?? null,
      connectorId: input.connectorId ?? null,
      category: input.category?.trim() || null,
      startedBy: input.actorId,
      status: input.status ?? "uploading",
    })
    .returning({ id: kbImports.id });
  if (!row) throw new Error("Failed to record the import");
  return row.id;
}

/**
 * An import runs inside this process. One that was under way when the process
 * stopped will never finish, and says so rather than spinning for ever.
 */
export async function failInterruptedImports(): Promise<number> {
  const rows = await db
    .update(kbImports)
    .set({
      status: "failed",
      error: "The server restarted before this import finished. Run it again.",
      finishedAt: new Date(),
    })
    .where(
      or(
        eq(kbImports.status, "running"),
        // An upload may be resumed for a while; one abandoned for a day will not be.
        and(
          eq(kbImports.status, "uploading"),
          lt(kbImports.startedAt, sql`now() - interval '1 day'`),
        ),
      ),
    )
    .returning({ id: kbImports.id });
  return rows.length;
}

export type TidySummary = { seen: number; changed: number };

/**
 * Runs the tidying an import now does over what was imported before it did:
 * every live Markdown article that came from a source, never one written
 * through a key. An article whose text changes is chunked again. One audit
 * entry per collection says how many.
 */
export async function tidyStoredArticles(
  collectionId: string,
  options: { dryRun?: boolean; log?: (line: string) => void } = {},
): Promise<TidySummary> {
  const rows = await db
    .select({ id: kbArticles.id, title: kbArticles.title, body: kbArticles.body })
    .from(kbArticles)
    .where(
      and(
        eq(kbArticles.collectionId, collectionId),
        eq(kbArticles.format, "markdown"),
        isNull(kbArticles.archivedAt),
        sql`not (${kbArticles.metadata} ? 'written_by')`,
        // Text an administrator edited here is theirs now, as it stands.
        sql`not (${kbArticles.metadata} ? 'edited_by')`,
      ),
    );

  const summary: TidySummary = { seen: rows.length, changed: 0 };
  for (const row of rows) {
    const body = tidyImportedMarkdown(row.body);
    if (body === row.body) continue;
    summary.changed += 1;
    options.log?.(`${row.id}  ${row.title}`);
    if (options.dryRun) continue;

    const chunks = chunkText(body);
    await db.transaction(async (tx) => {
      await tx.update(kbArticles).set({ body, updatedAt: new Date() }).where(eq(kbArticles.id, row.id));
      await tx.delete(kbChunks).where(eq(kbChunks.articleId, row.id));
      for (let at = 0; at < chunks.length; at += CHUNK_BATCH) {
        await tx.insert(kbChunks).values(
          chunks.slice(at, at + CHUNK_BATCH).map((chunk) => ({
            articleId: row.id,
            collectionId,
            ordinal: chunk.ordinal,
            title: row.title,
            heading: chunk.heading.slice(0, 500),
            content: chunk.content,
          })),
        );
      }
    });
  }

  if (!options.dryRun && summary.changed > 0) {
    await writeAudit({
      action: "kb_collection.tidied",
      entity: "kb_collection",
      entityId: collectionId,
      detail: summary,
    });
  }
  return summary;
}
