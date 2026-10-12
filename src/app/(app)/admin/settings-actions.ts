"use server";

import { revalidatePath } from "next/cache";
import { text, type FormState } from "@/lib/form";
import {
  ForbiddenError,
  requireAdmin,
  requireRecentMfa,
} from "@/server/auth/session";
import { ZodError } from "zod";
import { toFieldErrors } from "@/lib/form";
import {
  setDefaultLocale,
  setDomainCheckPolicy,
  setKbPublicSettings,
  setMacFormat,
} from "@/server/services/settings";

export async function setDefaultLocaleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireAdmin();
    await requireRecentMfa(user);
    await setDefaultLocale(text(formData, "defaultLocale") ?? null, user.id);
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }

  // The language reaches every page, so the whole tree is revalidated.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setMacFormatAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireAdmin();
    await requireRecentMfa(user);
    await setMacFormat(text(formData, "macFormat") ?? "", user.id);
  } catch (err) {
    if (err instanceof ZodError) return { fieldErrors: { macFormat: "Choose one of the formats listed" } };
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }

  // Documents show saved addresses in the format in force, so every page may change.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setKbPublicAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireAdmin();
    await requireRecentMfa(user);
    await setKbPublicSettings(
      {
        mode: (text(formData, "mode") ?? "off") as "off" | "addresses" | "open",
        addresses: String(formData.get("addresses") ?? ""),
        url: text(formData, "url") ?? "",
        accessTeam: text(formData, "accessTeam") ?? "",
        accessAud: text(formData, "accessAud") ?? "",
      },
      user.id,
    );
  } catch (err) {
    if (err instanceof ZodError) return { fieldErrors: toFieldErrors(err) };
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin/kb", "layout");
  return { ok: true };
}

export async function setDomainCheckPolicyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireAdmin();
    await requireRecentMfa(user);
    await setDomainCheckPolicy(
      {
        dns: text(formData, "dns"),
        tls: text(formData, "tls"),
        rdap: text(formData, "rdap"),
        email: text(formData, "email"),
        brand: text(formData, "brand"),
        tlsWarnDays: text(formData, "tlsWarnDays"),
      },
      user.id,
    );
  } catch (err) {
    if (err instanceof ZodError) return { fieldErrors: toFieldErrors(err) };
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }

  revalidatePath("/admin/settings");
  return { ok: true };
}
