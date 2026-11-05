import { redirect } from "next/navigation";
import { AppFrame } from "@/components/app-frame";
import { WhatsNew } from "@/components/whats-new";
import { isAdministrator, requireScopedUser } from "@/server/auth/session";
import { isSetupComplete } from "@/server/services/setup";
import { unseenReleases } from "@/server/services/whats-new";
import { getLocale } from "@/i18n/server";
import { formatDate } from "@/i18n/format";

export const dynamic = "force-dynamic";

/** Everything here needs a person who has finished signing in. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await isSetupComplete())) redirect("/setup");
  const { user, scope } = await requireScopedUser();

  // What's new since this person last closed the pop-up. A failure here never
  // keeps anyone out of the app.
  const [releases, locale] = await Promise.all([
    unseenReleases(user.id, isAdministrator(user.role)).catch((error) => {
      console.error("trove-kb: what's new lookup failed", error);
      return [];
    }),
    getLocale(),
  ]);

  return (
    <AppFrame user={user} scope={scope}>
      {children}
      {releases.length > 0 && (
        <WhatsNew
          releases={releases.map((release) => ({
            id: release.id,
            version: release.version,
            date: formatDate(release.deployedAt.toISOString().slice(0, 10), locale),
            entries: release.entries,
          }))}
        />
      )}
    </AppFrame>
  );
}
