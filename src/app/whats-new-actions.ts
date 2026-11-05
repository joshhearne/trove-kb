"use server";

import { requireUser } from "@/server/auth/session";
import { markReleasesSeen } from "@/server/services/whats-new";

/** The reader closed the What's new pop-up: releases up to this one stay closed. */
export async function markWhatsNewSeenAction(releaseId: number): Promise<void> {
  const user = await requireUser();
  await markReleasesSeen(user.id, Number(releaseId));
}
