"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { ForbiddenError, requireAdmin, requireRecentMfa } from "@/server/auth/session";
import {
  requestUpdateNow,
  setUpdatePolicy,
  UpdateNotAllowedError,
} from "@/server/services/updates";

export type SystemActionResult = { ok?: boolean; error?: string };

async function run(work: (userId: string) => Promise<void>): Promise<SystemActionResult> {
  try {
    const user = await requireAdmin();
    await requireRecentMfa(user, "/admin/system");
    await work(user.id);
  } catch (err) {
    if (err instanceof ZodError) return { error: err.issues[0]?.message ?? "Invalid value" };
    if (err instanceof ForbiddenError || err instanceof UpdateNotAllowedError) {
      return { error: err.message };
    }
    throw err;
  }
  revalidatePath("/admin/system");
  return { ok: true };
}

/** Production, development, or manual. */
export async function setUpdateChannelAction(channel: string): Promise<SystemActionResult> {
  return run((userId) => setUpdatePolicy({ channel }, userId));
}

/** The hour, server time, an available update installs at. */
export async function setUpdateHourAction(updateHour: number): Promise<SystemActionResult> {
  return run((userId) => setUpdatePolicy({ updateHour }, userId));
}

/** Install the available update on the host's next run. */
export async function requestUpdateNowAction(): Promise<SystemActionResult> {
  return run((userId) => requestUpdateNow(userId));
}
