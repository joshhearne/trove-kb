# Change files

Each user-visible change adds one small Markdown file here. The running app
turns the files that are new in a build into the **What's new** pop-up people
see after an update, and the host updater sends the files from the build it
would install next to Admin → System health → Updates as a preview.

```markdown
---
type: feature        # feature | improvement | fix
audience: everyone   # everyone | admins (default: admins)
---
Imported articles keep their numbered steps past a screenshot.
```

- **type** sets the bullet color: feature (blue), improvement (green), fix
  (orange).
- **audience**: `admins` entries are shown to administrators only (a role
  with the admin area). Use `everyone` when people who only read and edit
  documentation will notice the change.
- **Body**: one short sentence, written for the people using Trove KB, not for
  developers, in en-US. `**bold**` and `` `code` `` work. A `- ` list gives
  several bullets.
- **File name**: anything unique, such as the topic (`kb-numbered-steps.md`).
  It is the entry's id: don't rename a file after it has shipped. Fixing the
  wording is fine; running installs pick it up on their next start.
- Dependency bumps, refactors, tests and CI changes don't need a file.

Keep the list per update short. Shipping often keeps each pop-up readable.
