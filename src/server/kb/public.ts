import "server-only";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getKbPublicSettings } from "@/server/services/settings";
import { isListed } from "@/server/kb/addresses";
import { only } from "@/server/auth/company-scope";
import { publicIdentity } from "@/server/kb/identity";
import { companiesForEmail } from "@/server/services/company-domains";
import { getCompanyBranding } from "@/server/services/branding";
import { getCompany } from "@/server/services/companies";
import type { KbReader } from "@/server/services/kb";

/**
 * The gate on the public knowledge base. It is off until an operator turns it
 * on, and a collection is on it only when somebody put it there, so nothing is
 * public by default twice over.
 *
 * A visitor who is not admitted gets "not found", the same as a page that does
 * not exist: whether there is a knowledge base here at all is not theirs to
 * learn.
 */

/**
 * A visitor nobody has named belongs to no company: they see what is for
 * every company and nothing kept to one.
 */
export const PUBLIC_READER: KbReader = { scope: only([]), via: "public" };

/**
 * The reader for this visitor. When Cloudflare Access names them and the
 * domain of their address is one a company claims, they read as that
 * company's people would: what is for every company, and what is kept to
 * theirs. Nobody else sees a collection kept to a company.
 */
async function publicReader(): Promise<KbReader> {
  const identity = await publicIdentity();
  if (!identity) return PUBLIC_READER;
  const companyIds = await companiesForEmail(identity.email);
  return companyIds.length > 0
    ? { scope: only(companyIds), via: "public" }
    : PUBLIC_READER;
}

/**
 * The visitor's address, as the proxy in front reports it. The app listens
 * only to that proxy, which overwrites whatever a visitor claims.
 */
export async function visitorAddress(): Promise<string | null> {
  const list = await headers();
  const real = list.get("x-real-ip")?.trim();
  if (real) return real;

  // The last hop is the one our own proxy added; anything before it is the
  // visitor's word.
  const forwarded = list.get("x-forwarded-for")?.split(",").pop()?.trim();
  return forwarded || null;
}

/*
 * A search costs a query. One window per address, held in this process, as
 * the API's limiter is.
 */
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;
/** A page of photographs asks for each of them, so pictures are counted apart. */
const MAX_IMAGE_REQUESTS = 1_200;
/** An export makes a whole file, so far fewer are allowed. */
const MAX_EXPORT_REQUESTS = 20;
const windows = new Map<string, { count: number; resetAt: number }>();

function withinLimit(address: string, most = MAX_REQUESTS): boolean {
  const now = Date.now();
  if (windows.size > 10_000) {
    for (const [key, window] of windows)
      if (window.resetAt <= now) windows.delete(key);
  }

  const window = windows.get(address);
  if (!window || window.resetAt <= now) {
    windows.set(address, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  window.count += 1;
  return window.count <= most;
}

export class TooManyRequestsError extends Error {
  constructor() {
    super("Too many requests");
    this.name = "TooManyRequestsError";
  }
}

/**
 * The hostname this request arrived on, as the proxy in front reports it.
 * The public site is published on a hostname of its own, and answers there
 * alone: the same pages on the installation's own hostname would be the
 * knowledge base without the gate that hostname carries.
 */
async function arrivedOn(): Promise<string | null> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host");
  return host?.split(",")[0]?.trim().toLowerCase().replace(/:\d+$/, "") || null;
}

/** Whether the request is on the hostname the site is published at, when one is set. */
async function onPublishedHost(settings: {
  url: string | null;
}): Promise<boolean> {
  if (!settings.url) return true;
  try {
    return new URL(settings.url).hostname.toLowerCase() === (await arrivedOn());
  } catch {
    return true;
  }
}

export type VisitorCompany = {
  id: string;
  name: string;
  logoVersion: string | null;
};

/**
 * The company a named visitor is placed with, for the corner of the page:
 * its name, and whether it has a logo to draw there. Null for a visitor
 * nobody named or placed. Read after the gate, never instead of it.
 */
export async function visitorCompany(): Promise<VisitorCompany | null> {
  const identity = await publicIdentity();
  if (!identity) return null;
  const [companyId] = await companiesForEmail(identity.email);
  if (!companyId) return null;
  const scope = only([companyId]);
  const [branding, company] = await Promise.all([
    getCompanyBranding(companyId, scope),
    getCompany(companyId, scope),
  ]);
  const version = branding.logoUrl
    ? new URL(branding.logoUrl, "http://x").searchParams.get("v")
    : null;
  return { id: companyId, name: company?.name ?? "", logoVersion: version };
}

/** Admits the visitor or answers "not found". Every public page starts here. */
export async function requirePublicReader(): Promise<KbReader> {
  const settings = await getKbPublicSettings();
  if (settings.mode === "off") notFound();
  if (!(await onPublishedHost(settings))) notFound();

  const address = await visitorAddress();
  if (settings.mode === "addresses" && !isListed(address, settings.addresses))
    notFound();

  if (!withinLimit(address ?? "unknown")) throw new TooManyRequestsError();
  return publicReader();
}

/**
 * The same gate for a picture, which is fetched by a page and cannot be
 * answered with one. Null is "not found".
 */
export async function admitPublicImageReader(): Promise<KbReader | null> {
  const settings = await getKbPublicSettings();
  if (settings.mode === "off") return null;
  if (!(await onPublishedHost(settings))) return null;

  const address = await visitorAddress();
  if (settings.mode === "addresses" && !isListed(address, settings.addresses))
    return null;

  if (!withinLimit(`image:${address ?? "unknown"}`, MAX_IMAGE_REQUESTS)) {
    throw new TooManyRequestsError();
  }
  return publicReader();
}

/**
 * The same gate for an export, which is a download and cannot be answered
 * with a page either, and which costs far more than a page: counted apart,
 * with a much lower limit. Null is "not found".
 */
export async function admitPublicExportReader(): Promise<KbReader | null> {
  const settings = await getKbPublicSettings();
  if (settings.mode === "off") return null;
  if (!(await onPublishedHost(settings))) return null;

  const address = await visitorAddress();
  if (settings.mode === "addresses" && !isListed(address, settings.addresses))
    return null;

  if (!withinLimit(`export:${address ?? "unknown"}`, MAX_EXPORT_REQUESTS)) {
    throw new TooManyRequestsError();
  }
  return publicReader();
}
