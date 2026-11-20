import { AppShell } from "@/components/app-shell";
import { canManageDocTypes, canManageHierarchy, canUseSecretFields, type CurrentUser } from "@/server/auth/session";
import { listCompanies } from "@/server/services/companies";
import { signOutAction } from "@/app/sign-in/actions";
import { getTheme } from "@/server/theme";
import { getInstanceBranding } from "@/server/services/branding";
import { AppFooter } from "@/components/app-footer";
import type { CompanyScope } from "@/server/auth/company-scope";

/**
 * The signed-in frame: rail, header, account menu. Drawn for the pages that
 * need the person to have finished signing in and for the ones where they
 * finish it, so both layouts share it.
 */
export async function AppFrame({
  user,
  scope,
  children,
}: {
  user: CurrentUser;
  scope: CompanyScope;
  children: React.ReactNode;
}) {
  const companies = await listCompanies(scope);
  const [theme, branding] = await Promise.all([getTheme(), getInstanceBranding()]);

  return (
    <AppShell
      user={{ name: user.name, email: user.email, role: user.role }}
      canCreateCompanies={canManageHierarchy(user.role)}
      canManageDocTypes={canManageDocTypes(user.role)}
      theme={theme}
      secretStyle={canUseSecretFields(user.role) ? user.secretStyle : null}
      editorView={user.editorView}
      branding={branding}
      footer={<AppFooter />}
      signOut={signOutAction}
      companies={companies.map((company) => ({
        id: company.id,
        name: company.name,
        isInternal: company.isInternal,
      }))}
    >
      {children}
    </AppShell>
  );
}
