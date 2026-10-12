/**
 * The base catalog. Every string the interface shows lives here; other locales
 * override only what differs (see en-GB.ts).
 */
export const enUS = {
  app: {
    name: "Trove KB",
    signOut: "Sign out",
    openNavigation: "Open navigation",
    closeNavigation: "Close navigation",
    navigation: "Navigation",
    mainNavigation: "Main",
    search: "Search",
    searchDocuments: "Search documents",
    language: "Language",
    theme: "Theme",
    themes: {
      system: "System",
      light: "Light",
      dark: "Dark",
    },
    secretStyle: "Secret colors",
    secretStyles: {
      on: "Letters, digits, symbols",
      colorblind: "Color-blind palette",
      off: "Off",
    },
    account: "Account",
    accountMenuFor: (name: string) => `Account menu for ${name}`,
    signedInAs: "Signed in as",
    closeAccount: "Close account menu",
    poweredBy: (product: string, vendor: string) =>
      `Powered by ${product} | ${vendor}`,
    source: "Source code",
    version: "Version",
  },

  nav: {
    companies: "Companies",
    allCompanies: "All companies",
    newCompany: "New company",
    noCompanies: "No companies yet.",
    internal: "internal",
    admin: "Admin",
    docTypes: "Doc types",
    branding: "Branding",
    optionLists: "Option lists",
    apiKeys: "API keys",
    webhooks: "Webhooks",
    vault: "Vault",
    users: "Users",
    roles: "Roles",
    notifications: "Notifications",
    settings: "Settings",
    auditLog: "Audit log",
    knowledgeBase: "Knowledge base",
    allCollections: "All collections",
    portal: "Portal",
  },

  common: {
    save: "Save",
    close: "Close",
    saving: "Saving…",
    clear: "Clear",
    cancel: "Cancel",
    edit: "Edit",
    archive: "Archive",
    restore: "Restore",
    remove: "Remove",
    delete: "Delete",
    showArchived: "Show archived",
    hideArchived: "Hide archived",
    archived: "Archived",
    required: "Required",
    name: "Name",
    notes: "Notes",
    title: "Title",
    none: "—",
    saved: "Saved.",
    noPermission: "You do not have permission to do that",
    copy: "Copy",
    copied: "Copied!",
    copyFailed: "Select and copy",
    copyHint: "Click to copy",
  },

  setup: {
    heading: "Welcome to Trove KB",
    description:
      "Create the first administrator account. This is the only time sign-up is open.",
    yourName: "Your name",
    email: "Email",
    password: "Password",
    confirmPassword: "Confirm password",
    passwordHint: (min: number) => `At least ${min} characters.`,
    mfaNext: "You will be asked to set up a second sign-in step within a week.",
    submit: "Create admin account",
    submitting: "Creating account…",
    passwordsDiffer: "Passwords do not match",
  },

  signIn: {
    heading: "Sign in to Trove KB",
    localOnly: "Use your local account.",
    withSso: "Use single sign-on or a local account.",
    email: "Email",
    password: "Password",
    submit: "Sign in",
    submitting: "Signing in…",
    sso: "Sign in with SSO",
    orLocal: "or use a local account",
    invalid: "Incorrect email or password",
    rateLimited: "Too many attempts. Try again shortly.",
    forgot: "Forgot your password?",
    forgotHeading: "Reset your password",
    forgotDescription:
      "Enter your email address. If there is an account for it, a link to choose a new password is on its way, good for an hour.",
    forgotSubmit: "Send the link",
    forgotSent:
      "If there is an account for that address, a link is on its way. Check your mail.",
    resetHeading: "Choose a new password",
    resetDescription: "Your other sessions will be signed out.",
    resetSubmit: "Set password",
    resetExpired: "That link has expired or was already used. Ask for another.",
    resetDone: "Your password is changed. Sign in with it.",
  },

  password: {
    show: "Show password",
    hide: "Hide password",
    rulesHeading: "A password needs",
    rules: {
      length: "8 to 128 characters",
      upper: "an uppercase letter",
      lower: "a lowercase letter",
      number: "a number",
      special: "a symbol or a space",
      identity: "none of your name or email address",
    },
    policy: "The password does not meet the rules listed.",
    breached: (count: number) =>
      `That password has appeared in ${count.toLocaleString("en-US")} data breaches. Choose another.`,
    wrongCurrent: "The current password is not right.",
  },

  mfa: {
    heading: "One more step",
    description:
      "Enter the code from your authenticator app, or use a passkey.",
    again: "This part of the site asks for your second step again.",
    code: "Six-digit code",
    verify: "Verify",
    verifying: "Verifying…",
    usePasskey: "Use a passkey",
    passkeyWaiting: "Waiting for your passkey…",
    passkeyFailed: "The passkey was not accepted. Try again, or use a code.",
    useRecovery: "Use a recovery code instead",
    recoveryCode: "Recovery code",
    recoveryLeft: (left: number) =>
      left === 0
        ? "That was your last recovery code. Make a new set under Personal settings."
        : left === 1
          ? "1 recovery code left."
          : `${left} recovery codes left.`,
    wrongCode: "That code is not right.",
    locked: (until: string) =>
      `Too many wrong answers. Try again after ${until}.`,
    expired: "Start again: that setup has expired.",
    signOut: "Sign out",
  },

  account: {
    title: "Personal settings",
    security: "Security",
    password: "Password",
    passwordHint:
      "Choose your own. Your other sessions are signed out when it changes.",
    passwordRequired:
      "You signed in with a temporary password. Choose your own to carry on.",
    current: "Current password",
    next: "New password",
    confirm: "Confirm new password",
    mismatch: "The two passwords do not match.",
    changePassword: "Change password",
    passwordChanged: "Your password is changed.",

    mfaTitle: "Second sign-in step",
    mfaHint:
      "A code from an authenticator app, a passkey, or both. Once anything is enrolled, every sign-in asks for it.",
    mfaRequired: (when: string) =>
      `Administrators must enroll a second step. Yours is due by ${when}.`,
    mfaOverdue:
      "Administrators must enroll a second step before going on. Set one up below.",
    mfaEncouraged:
      "Optional for your role, and worth having: it keeps a stolen password from being enough.",
    enrolledNothing: "Nothing enrolled yet.",

    totp: "Authenticator app",
    totpHint:
      "Microsoft Authenticator, Google Authenticator, 1Password, or any app that takes a code.",
    totpEnrolled: (when: string) => `Enrolled ${when}.`,
    totpSetUp: "Set up an authenticator app",
    totpScan: "Scan this with your app, or type the key into it.",
    totpKey: "Key",
    totpConfirm: "Then enter the code the app shows",
    totpConfirmSubmit: "Turn on",
    totpRemove: "Remove the app",
    totpRemoveHint: "Sign-in will no longer ask for a code from it.",

    passkeys: "Passkeys",
    passkeysHint:
      "A security key such as a YubiKey, or a passkey held by your device or password manager. Passkeys cannot be phished.",
    passkeyAdd: "Add a passkey",
    passkeyLabel: "Name for this passkey",
    passkeyLabelHint: 'So you know which is which: "Work YubiKey", "Laptop".',
    passkeyAdding: "Follow your browser's prompt…",
    passkeyFailed: "The passkey could not be added. Try again.",
    passkeyUnsupported: "This browser cannot make passkeys.",
    passkeyAdded: (when: string) => `Added ${when}`,
    passkeyUsed: (when: string) => `last used ${when}`,
    passkeyNeverUsed: "never used",
    passkeyRename: "Rename",
    passkeyRemove: "Remove",
    hardware: "security key",
    software: "device or password manager",

    recovery: "Recovery codes",
    recoveryHint:
      "For when the app and the passkey are both out of reach. Each works once. Keep them somewhere safe, away from your password.",
    recoveryLeft: (left: number) =>
      left === 1 ? "1 unused code." : `${left} unused codes.`,
    recoveryNone: "You have none. Make a set.",
    recoveryMake: "Make a new set",
    recoveryMakeHint: "The old set stops working.",
    recoveryShown: "Copy these now. They will not be shown again.",
    recoveryDone: "I have saved them",

    lastFactorWarning:
      "This is your only second step. Removing it turns the second step off for your account.",
    adminNeedsOne:
      "Administrators must keep at least one second step enrolled.",
  },

  companies: {
    domainChecks: "Domain checks",
    domainChecksHint:
      "Timings for this company's domain records. Whatever is left on the instance default follows Admin → Settings; a record can still set its own.",
    domainChecksSave: "Update domain checks",
    brandFromDomain: "From the company's websites",
    brandFromDomainHint:
      "What each website publishes about its own look, read by the Website branding check on the company's domain records. Pick one to make it the company theme; with several websites, the one chosen is marked.",
    brandFromDomainEmpty:
      "No website branding yet. Turn on the Website branding check on one of this company's domain records and run it.",
    brandApplied: "Applied",
    brandLogo: "Logo",
    brandAccent: "Accent",
    brandKeep: "Keep current",
    brandNoRaster:
      "The site offers no PNG, JPEG, WebP or SVG icon; an ICO cannot be a logo here. An SVG is rendered to PNG with its transparency kept.",
    brandNoColor:
      "The site publishes no theme color, and its stylesheets paint with none.",
    brandApply: "Use as company theme",
    customers: "Customers on the knowledge base",
    customersHint:
      "People of this company who reach the public knowledge base through Cloudflare Access are placed here by the domain of their email address, and then see the collections for every company plus those kept to this one.",
    signInDomains: "Sign-in email domains",
    signInDomainsHint:
      "One per line, or comma separated: example.com. A domain can place people with one company only.",
    signInDomainsSave: "Update sign-in domains",
    title: "Companies",
    empty: "No companies yet. Create one to start documenting.",
    noneGranted:
      "No companies have been shared with you yet. Ask an administrator for access.",
    newHeading: "New company",
    editHeading: (name: string) => `Edit ${name}`,
    create: "Create company",
    saveChanges: "Save changes",
    internalBadge: "Internal",
    isInternal: "This is my own organization",
    notesHint: "Markdown is supported.",
    locations: "Locations",
    noLocations: "No locations yet.",
    locationName: "Location name",
    address: "Address",
    addressOptional: "Optional",
    addLocation: "Add location",
    editLocationHeading: (name: string) => `Edit ${name}`,
    documents: "Documents",
    noDocuments: "No documents yet.",
    newDocument: "New document",
    exportJson: "Export JSON",
    exportMarkdown: "Export Markdown",
    counts: (locations: string, documents: string) =>
      `${locations} · ${documents}`,
  },

  documents: {
    pickDocType: (company: string) => `Pick a doc type for ${company}.`,
    noDocTypes:
      "No doc types exist yet. An administrator creates them under Admin → Doc types.",
    needsLocation: (docType: string) =>
      `${docType} documents attach to a location. Pick one.`,
    noLocationsForCompany: (company: string) =>
      `${company} has no locations yet. Add one on the company page first.`,
    chooseDifferentType: "Choose a different doc type",
    newOf: (docType: string) => `New ${docType}`,
    create: "Create document",
    saveDocument: "Save document",
    editHeading: (title: string) => `Edit ${title}`,
    history: "History",
    historyHeading: "History",
    backToDocument: "Back to document",
    noRevisions: "No revisions recorded.",
    current: "current",
    updated: (when: string) => `Updated ${when}`,
    noFields: "This doc type has no fields yet.",
    linkedFrom: "Linked from",
    attachments: "Attachments",
    noAttachments: "No files attached.",
    addFile: "Add a file",
    upload: "Upload",
    uploading: "Uploading…",
    schedule: {
      heading: "Review schedule",
      subtitle: "When this needs looking at again.",
      none: "Nothing scheduled.",
      kind: "What kind",
      expiry: "A date it expires",
      maintenance: "A job that comes round",
      dueOn: "Next due",
      interval: "How often, in days",
      intervalHint: "90 for quarterly, 365 for yearly.",
      lead: "Warn this many days ahead",
      note: "Note",
      save: "Save schedule",
      clear: "Clear schedule",
      done: "Mark done",
      overdue: (days: number) =>
        `Overdue by ${days} ${days === 1 ? "day" : "days"}.`,
      dueSoon: (days: number) =>
        days === 0
          ? "Due today."
          : `Due in ${days} ${days === 1 ? "day" : "days"}.`,
      ok: (date: string) => `Next due ${date}.`,
      lastDone: (date: string) => `Last done ${date}.`,
      stamped:
        "From the doc type. Editing it here makes it this document's own.",
      typeHeading: "Review schedule for every document of this type",
      typeHint:
        "Every document of this type starts with this. A doc type cannot know a date, so the first one is counted from the day a document is created.",
      typeKind: "What kind",
      typeNone: "No schedule",
      typeDueDays: "First one, days after creation",
      typeInterval: "Then how often, in days",
      typeLead: "Warn this many days ahead",
      typeSave: "Save schedule",
      typeApply: "Also apply to existing documents",
      typeApplyHint:
        "Stamps it into documents of this type that have no schedule of their own. Nothing that already has one is touched.",
      typeApplied: (count: number) =>
        count === 1
          ? "Stamped into 1 document."
          : `Stamped into ${count} documents.`,
    },

    rack: {
      heading: "Rack elevation",
      subtitle: "What is mounted where, and a drawing you can print.",
      notARack: "This document is not a rack yet.",
      makeRack: "Make this a rack",
      size: "Rack units",
      sizeHint: "How many units the rack has, from 1 to 60.",
      hasRear: "The rear is used too",
      hasRearHint: "Draws a second elevation for anything mounted at the back.",
      numbering: "Unit numbering",
      bottomUp: "U1 at the bottom",
      topDown: "U1 at the top",
      numberingHint: "Match the numbers printed on this rack's rails.",
      save: "Save rack",
      front: "Front",
      rear: "Rear",
      print: "Print",
      download: (face: string) => `Download ${face} as SVG`,
      contents: "What is where",
      empty: "Nothing is mounted yet.",
      mount: "Mount something",
      position: "Lowest unit",
      height: "Height in units",
      face: "Face",
      faceBoth: "Front and rear",
      document: "A document",
      documentHint:
        "Pick something already written up, or leave it and type a label.",
      label: "Or a label",
      labelHint: "For a patch panel or a shelf nobody will ever document.",
      type: "Kind",
      typeHint: "Decides its color. Taken from the document when you pick one.",
      add: "Mount it",
      remove: "Remove",
      key: "Color key",
      overridden: "client override",
      defaultIs: (color: string) => `default is ${color}`,
      setGlobal: "Set for every client",
      setCompany: "Override for this client",
      warnings: "Worth a look",
      tooClose: (a: string, b: string) =>
        `${a} and ${b} are too close to tell apart in print.`,
      overrideShadows: (type: string, other: string) =>
        `This client's ${type} color is the one ${other} already uses here — change the override.`,
      overlap: (a: string, b: string, units: string) =>
        `${a} and ${b} both claim unit ${units}.`,
      outOfRange: (name: string) => `${name} runs past the top of the rack.`,
    },

    domain: {
      heading: "Domain checks",
      subtitle:
        "Looked up against the domain in this record, when asked and on a schedule.",
      dns: "DNS records",
      dnsHint: "A, AAAA, MX, NS and TXT, and who is answering for the domain.",
      tls: "TLS certificate",
      tlsHint: "Issuer, what it covers, and how long it has left.",
      rdap: "Domain registration",
      rdapHint:
        "The registry's own record: registrar, expiry, and transfer lock.",
      email: "Email posture",
      brand: "Website branding",
      brandHint:
        "The site's own title, the logo it shows, the colors it paints with, and the icons it offers browsers, offered to the company's branding.",
      brandApplyHint:
        "Apply a website's look as the company theme from the company's edit page.",
      emailHint:
        "Whether SPF, DMARC and DKIM are published, and what DMARC enforces.",
      save: "Save choices",
      run: "Check now",
      running: "Checking…",
      never: "Not checked yet.",
      lastChecked: (when: string) => `Last checked ${when}.`,
      noField: "This doc type has no field marked as holding a domain.",
      noDomain: "Fill in the domain first.",
      notADomain: (value: string) =>
        `“${value}” is not a domain this can look up.`,
      nothingOn: "Turn on at least one check.",
      use: "Use this",
      useHint: (label: string, value: string) =>
        `Set this record's ${label} to “${value}”.`,
      useHintOption: (label: string, value: string, current: string) =>
        `Add “${value}” to the shared list as its own option and set this record's ${label} to it. “${current}” stays for the records that use it.`,
      update: "Update",
      updateHint: (current: string, value: string) =>
        `Rename “${current}” to “${value}” in the shared list, so every record that uses it reads the new name.`,
      suggests: (source: string, value: string) => `${source} says ${value}`,
      recordedAs: (current: string) => `(recorded as ${current})`,
      matches: "matches what is recorded",
      matchesAs: (recorded: string) => `matches what is recorded (${recorded})`,
      registrar: "Registrar",
      dnsHost: "DNS host",
      expiry: "Expiration",
      records: "Records",
      unavailable: "Lookups are not available in this deployment.",
      automatic: "Check automatically",
      automaticHint:
        "The worker re-runs each check on its own clock, says what changed, and warns ahead of an expiry.",
      interval: "How often",
      every: (days: number) =>
        days === 1 ? "every day" : `every ${days} days`,
      off: "off",
      companyDefault: (label: string) => `Company default (${label})`,
      instanceDefault: (label: string) => `Instance default (${label})`,
      intervalEvery: (days: number) =>
        days === 1 ? "Every day" : `Every ${days} days`,
      nextRun: (when: string) => `Next automatic check ${when}.`,
      automaticOff:
        "Nothing will run on its own: every chosen check is off for this company or this instance.",
      autoRenews: "The certificate renews automatically",
      autoRenewsHint:
        "Its expiry is then no cause for alarm. Set a notice anyway if you do not trust the renewal.",
      tlsWarn: "Warn when fewer than",
      tlsWarnDefault: (days: number) => `Default (${days} days)`,
      tlsWarnDays: (days: number) => `${days} days`,
      tlsNoWarning: "No expiry warning: the certificate renews automatically.",
      sectionChecked: (when: string) => `checked ${when}`,
      sectionNext: (when: string) => `next ${when}`,
      txt: "TXT",
      cname: "CNAME",
      spfRecord: "SPF",
      dmarcRecord: "DMARC",
      dmarcVia: (host: string) => `via CNAME to ${host}`,
      dkimSelectors: "DKIM selectors",
      dkimSelectorsHint:
        "A key lives under a selector that cannot be listed. The common ones are tried; name this domain's own here, comma separated, or DKIM will read as missing.",
      dkimTried: (selectors: string) => `tried ${selectors}`,
      check: "Check",
      finding: "Finding",
      record: "Record",
      none: "none",
      lastCheckedAuto: (when: string) => `Last checked ${when}, automatically.`,
      autoError: (reason: string) =>
        `The last automatic check could not run: ${reason}`,
    },
    uploadTypes:
      "Images (HEIC is converted to JPEG), PDF, Word, Excel, PowerPoint, CSV, Markdown, and text.",
    uploadLimit: (mb: number) => `Up to ${mb} MB per file.`,
    companyScope: "Company scope",
    locationScope: "Location scope",
    richText: {
      bold: "Bold",
      italic: "Italic",
      heading: "Heading",
      quote: "Quote",
      bulletList: "Bullet list",
      numberedList: "Numbered list",
      taskList: "Checklist",
      codeBlock: "Code block",
      table: "Table",
      addRow: "Add row",
      addColumn: "Add column",
      deleteRow: "Delete row",
      deleteColumn: "Delete column",
      deleteTable: "Delete table",
      view: "View",
      visual: "Visual",
      source: "Markdown",
      sourceHint:
        "Write or paste Markdown here. Headings, lists, tables, and checklists are kept as written.",
    },
  },

  editor: {
    addField: "Add field",
    addFieldHeading: "Add a field to this document",
    addFieldDescription:
      "It belongs to this document only until you add it to the template.",
    addToTemplate: "Add to template",
    promoteHeading: (label: string, docType: string) =>
      `Add "${label}" to the ${docType} template`,
    promoteDescription:
      "Confirm the label, type, and option list. Every document of this type gains the field, empty.",
    thisDocument: "This document",
    reorderField: (label: string) => `Reorder ${label}`,
    applyOrder: "Apply new field order",
    applyOrderPrompt: "Apply this order to…",
    thisDocumentOnly: "This document only",
    updateTemplate: "Update template",
    orderSavedForDocument: "Field order saved for this document.",
    orderSavedForTemplate: (docType: string) =>
      `Field order updated for every ${docType} document.`,
    added: (label: string) => `Added ${label}.`,
    archivedField: (label: string) => `Archived ${label}.`,
    promoted: (label: string) => `"${label}" is now part of the template.`,
    addedOption: (label: string) => `Added "${label}".`,
    addOptionTo: (label: string) => `Add an option to ${label}`,
    newOptionFor: (label: string) => `New option for ${label}`,
    add: "Add",
    adding: "Adding…",
    label: "Label",
    type: "Type",
    optionList: "Option list",
    chooseList: "Choose a list…",
    linksTo: "Links to",
    anyDocumentInCompany: "Any document in this company",
    emptyList: "This list has no options yet.",
    notEditable: "This field type is not editable yet.",
    noVaultItems:
      "No vault items are available. Map this company to a Bitwarden collection under Admin → Vault, and check the sidecar is unlocked.",
    failed: "That did not work",
    net: {
      ipHint:
        "On the document this field comes with a prefix (/nn) selector beside the address. Leave the prefix blank for a single address: it is saved as /32 (IPv4) or /128 (IPv6). Pick one such as /24 to record the subnet the address sits on, and the network block is worked out when the document is saved.",
      networkHint:
        "Holds a whole network, not one address. On the document a prefix is required, from /31 down to /0 for IPv4 (/127 for IPv6), and the network address is taken from it when the document is saved: 192.168.1.77/24 is kept as 192.168.1.0/24.",
      ipListHint:
        "Several addresses in order, such as DNS servers: put the primary first. Each one works like an IP address field, with its own prefix selector, and a blank prefix is a single address. Pasting a whole list fills a row for each address.",
      rangeHint:
        "A first and a last address, such as a DHCP pool. Both ends must be IPv4, or both IPv6.",
      macHint:
        "Anything typed or pasted into the field is rewritten in this format straight away, and saved that way.",
      vlanHint: "A whole number from 1 to 4094.",
      hostnameHint:
        "A short name such as fw01, or a fully qualified one such as fw01.example.com. Saved in lowercase.",
      macFormat: "MAC address format",
      macFormatDefault: (example: string) => `Instance default (${example})`,
      macFormats: {
        colon_upper: "Colons, uppercase",
        colon_lower: "Colons, lowercase",
        hyphen_upper: "Hyphens, uppercase",
        hyphen_lower: "Hyphens, lowercase",
        dot_lower: "Dotted groups of four, lowercase",
        dot_upper: "Dotted groups of four, uppercase",
        bare_upper: "No separators, uppercase",
        bare_lower: "No separators, lowercase",
      },
      address: (label: string) => `${label} address`,
      prefix: (label: string) => `${label} prefix`,
      singleAddress: (max: number) => `/${max} (single address)`,
      choosePrefix: "Prefix…",
      ipControlHint:
        "Leave the prefix blank for a single address. Pasting 10.0.0.5/24 or 10.0.0.5 255.255.255.0 fills both.",
      networkControlHint:
        "Pick the prefix. Pasting 10.0.0.0/24 or 10.0.0.0 255.255.255.0 fills both.",
      singleAddressPreview: (max: number) => `One address (/${max}).`,
      onNetworkPreview: (network: string, first: string, last: string, usable: string) =>
        `On ${network}: usable ${first} to ${last} (${usable}).`,
      networkPreview: (first: string, last: string, usable: string) =>
        `Usable ${first} to ${last} (${usable}).`,
      savedAs: (text: string) => `Saved as ${text}.`,
      listEntry: (label: string, n: number) => `${label} ${n}`,
      addAddress: "Add address",
      moveUp: (entry: string) => `Move ${entry} up`,
      moveDown: (entry: string) => `Move ${entry} down`,
      remove: (entry: string) => `Remove ${entry}`,
      rangeStart: (label: string) => `${label}, first address`,
      rangeEnd: (label: string) => `${label}, last address`,
      rangePreview: (count: string) => `${count} addresses.`,
      macPreview: (example: string) => `Written as ${example}.`,
      badgeAddress: "Address",
      badgeNetwork: "Network",
      onNetwork: (network: string) => `on ${network}`,
      networkAddressNote:
        "This is the network's own address, which no host can use. A Network field may suit it better.",
      blockDetails: "Block details",
      blockNetwork: "Network",
      blockMask: "Subnet mask",
      blockWildcard: "Wildcard mask",
      blockBroadcast: "Broadcast",
      blockUsableRange: "Usable range",
      blockUsable: "Usable addresses",
      blockTotal: "Total addresses",
      rangeSize: (count: string) => `${count} addresses`,
      locallyAdministered: "Locally administered: set by software or by hand, not by the maker.",
    },
  },

  secrets: {
    revealPassword: "Reveal password",
    hide: "Hide",
    hidePassword: "Hide password",
    totp: "TOTP",
    noPermission: "You do not have permission to reveal secrets.",
    linkOnlyProvider: "This provider stores links only.",
    locked: "The vault is locked, so this field is showing a link only.",
    unreachable:
      "The vault sidecar is unreachable, so this field is showing a link only.",
    openWebVault: "Open in the web vault",
  },

  secretText: {
    spellOut: "Spell out",
    hideSpelling: "Hide spelling",
    readback: "Readback",
    asIn: "as in",
    capital: "Capital",
    copyReadback: "Copy readback",
    letters: "Letters",
    digits: "Digits",
    symbols: "Symbols",
  },

  search: {
    title: "Search",
    placeholder: "Search every document",
    query: "Search query",
    company: "Company",
    anyCompany: "Any company",
    docType: "Doc type",
    anyDocType: "Any doc type",
    submit: "Search",
    hint: "Type a word or phrase. Quoted phrases and OR work, and titles rank above field values.",
    noMatches: (q: string) => `Nothing matches ${q}.`,
    onThisPage: " on this page",
    nextPage: "Next page",
  },

  kb: {
    title: "Knowledge base",
    subtitle:
      "Reference material brought in from outside, kept apart from client documentation.",
    empty:
      "No collections yet. An administrator adds them under Admin → Knowledge base.",
    noneShared: "No collections have been shared with you.",
    placeholder: "Search the knowledge base",
    query: "Search query",
    collection: "Collection",
    anyCollection: "Every collection",
    submit: "Search",
    hint: "Searches articles and the text of their attached documents. Quoted phrases and OR work.",
    noMatches: (q: string) => `Nothing matches ${q}.`,
    onThisPage: " on this page",
    nextPage: "Next page",
    matchedUnder: (heading: string) => `Under ${heading}`,
    source: "Open the source",
    sourceShort: "Source",
    categories: "Categories",
    types: "Kinds",
    openSite: "Open the original site",
    typeNames: {
      pdf: (count: number) => (count === 1 ? "1 PDF" : `${count} PDFs`),
      docx: (count: number) =>
        count === 1 ? "1 Word doc" : `${count} Word docs`,
      article: (count: number) =>
        count === 1 ? "1 Imported Doc" : `${count} Imported Docs`,
    },
    allCategories: "Everything",
    uncategorized: "Uncategorized",
    noArticles: "No articles here.",
    backTo: (name: string) => `Back to ${name}`,
    modified: (when: string) => `Modified ${when}`,
    created: (when: string) => `Created ${when}`,
    imported: (when: string) => `Imported ${when}`,
    articleId: (id: string) => `Article ${id}`,
    unextracted: "No text could be read",
    unextractedBody:
      "This file has no text layer — it is a scan or an image — so there is nothing to show or search. Open the source to read it.",
    unextractedAttachments: (names: string) =>
      `No text could be read from: ${names}. Open the source to see them.`,
    attachments: "Attached documents",
    searchInstead: (q: string) => `Search the knowledge base for ${q}`,
    publicEmpty: "Nothing has been published here yet.",
    onPublicSite: "On the public site",
    withheld: "Held back from the public site",
    withheldByRule: "Held back from the public site by a keyword rule",
    withheldWithCategory: "Held back from the public site with its category",
    withhold: "Hold back",
    publish: "Put back",

    outline: "On this page",
    runbook: "Runbook",
    newArticle: "New article",
    editArticle: "Edit",
    editor: {
      newTitle: "New article",
      editTitle: "Edit article",
      title: "Title",
      category: "Category",
      subcategory: "Section",
      runbook: "This is a runbook",
      runbookHint:
        "The items of the body's first numbered list become its steps. Each step is given an id on save, written at the end of the line as {#id}; keep those when you edit so progress tracked elsewhere stays with the step.",
      internalOnly: "Keep off the public site",
      internalOnlyHint:
        "Readable by signed-in people only, even when the collection is on the public site.",
      body: "Body",
      bodyHint: "Markdown. A line of its own with # starts a heading.",
      stepsPreview: "Steps as they will be saved",
      noSteps: "No numbered list yet, so no steps.",
      stepNote: "Note",
      save: "Save article",
      cancel: "Cancel",
      newValue: "New…",
      newCategory: "New category",
      newSection: "New section",
      noSection: "No section",
      noCategory: "No category",
      collection: "Knowledge base",
      move: "Move…",
      moveTitle: "Move to another knowledge base",
      moveHint:
        "The article keeps its name, pictures, and history. Its category and section can be set for the new place before saving.",
      moveLocked:
        "Moving is an administrator's step and needs your second sign-in step fresh. Unlock it, and you come straight back here.",
      moveUnlock: "Unlock moving",
      moveOnlyAdmins: "Only an administrator can move an article.",
      moveTo: "Move to",
      moveConfirm: "Move here",
      movePending: (name: string) => `Will move to ${name} when saved.`,
      importedNote:
        "This article was brought in from a file or a website. Changes made here are kept until the next import of the same article replaces them.",
    },
    runbookSteps: "Steps",
    runbookHint:
      "Tick steps as you go. Nothing is saved here; a ticketing system that links this runbook keeps its own progress.",
    runbookCanned: (name: string) => `Reply template: ${name}`,
    runbookDone: (done: number, total: number) => `${done} of ${total} done`,
    openPdf: "Open the PDF",
    pdfHint:
      "Text doesn't read right? Open the PDF to see it as written, or download it.",
    downloadOriginal: "Download the original",
    collapse: "Collapse",
    expand: "Expand",
    publicLink: "Copy public link",
    publicLinkCopied: "Public link copied",
    view: "View",
    viewCards: "Cards",
    viewList: "List",
    sortBy: "Sort by",
    direction: "Order",
    ascending: "Ascending",
    descending: "Descending",
    sorts: {
      name: "Name",
      modified: "Last edited",
      articles: "Most articles",
      favorites: "Most favorites",
      helpful: "Most helpful",
    },
    collections: "Knowledge bases",
    favorites: "My favorites",
    favoritesHint: "Kept for you, wherever you sign in.",
    noFavorites:
      "Nothing yet. Open an article and choose Favorite to keep it here.",
    favorite: "Favorite",
    unfavorite: "Favorited",
    favoriteCount: (count: number) =>
      count === 1 ? "1 favorite" : `${count} favorites`,
    helpfulPages: "Helpful pages",
    helpfulHint: "What readers found most helpful.",
    noHelpful: "Nobody has voted yet.",
    recentPages: "Recently updated",
    recentHint: "The pages that changed last.",
    wasHelpful: "Was this helpful?",
    thumbsUp: "Helpful",
    thumbsDown: "Not helpful",
    helpfulScore: (percent: number, votes: number) =>
      `${percent}% helpful · ${votes === 1 ? "1 vote" : `${votes} votes`}`,
    noVotes: "No votes yet",
    yourVote: "Your vote is counted. Choose it again to take it back.",
  },

  access: {
    legend: "Company access",
    all: "Every company",
    only: "Only the companies I choose",
    none: "No companies exist yet.",
    hint: "A new account starts with no access until it is granted here.",
    keyHint:
      "The key sees only these companies, through the API and through MCP.",
    kbOnly: "No companies: knowledge base only",
    kbOnlyHint:
      "Reads no documentation. What it may do is set per collection under Admin → Knowledge base.",
    save: "Save access",
  },

  admin: {
    subtitle: "Everything that is set once for the whole instance.",
    notifications: {
      title: "Notifications",
      subtitle:
        "What is due or overdue across every company you can see. A webhook goes out when something arrives here.",
      empty: "Nothing is due.",
      overdue: "Overdue",
      dueSoon: "Due soon",
      open: "Open",
      due: (date: string) => `due ${date}`,
      domains: "Domain checks",
      domainsHint:
        "What the last check of each domain record flagged. A webhook goes out when a check finds something different, and once per expiry date.",
      domainsEmpty: "Every checked domain looks fine.",
      checked: (when: string) => `checked ${when}`,
    },
    portal: {
      title: "Customer portal",
      subtitle:
        "The public knowledge base on a hostname of its own, such as kb.example.com: what is set, what answers, and what is on it.",
      status: "Where it stands",
      stepMode: "The public site is on",
      stepUrl: "A published address is set",
      urlUnset: "Not set. Enter it below once the hostname exists.",
      stepHostname: "The published address reaches this installation",
      hostnameUnset: "Set the published address first.",
      hostnameAnswers: "It answers.",
      hostnameAnswersOther: (status: number) =>
        `It answers ${status}. A 404 means the site is off, or the hostname does not match what is set.`,
      hostnameRefused: (reason: string) => `Not checked from here: ${reason}`,
      hostnameUnreachable:
        "It does not answer. Check the hostname's DNS and the tunnel's route.",
      stepAccess: "Cloudflare Access names each visitor",
      accessUnset:
        "Not set. Without it visitors are anonymous: no favorites, no votes, and no company's own collections.",
      accessNotSeen:
        "Set, but no token has reached this installation since it last started.",
      accessSeen: (when: string) => `Working: a token last verified ${when}.`,
      stepCollections: "Collections are on the site",
      onSite: "on the site",
      notOnSite: "not on the site",
      everyCompany: "for every company",
      keptTo: (names: string) => `kept to ${names}`,
      stepCustomers: "Companies place their people by email domain",
      customersUnset:
        "None yet. On a company's edit page, list the email domains its people sign in with.",
      customersSet: (count: number) =>
        count === 1
          ? "1 company places its people."
          : `${count} companies place their people.`,
      stepBranding: "The site carries your branding",
      brandingUnset:
        "The footer still credits the vendor. Put your name on it under Branding.",
      brandingSet: (name: string) =>
        `The footer reads “Powered by Trove KB | ${name}”.`,
      cloudflare: "In Cloudflare",
      cloudflareSteps: [
        "Zero Trust → Networks → Tunnels → your tunnel → Public Hostname → Add: the knowledge base's hostname, type HTTP, URL 127.0.0.1 and this installation's port, path left empty. Saving it creates the DNS record.",
        "Zero Trust → Access → Applications → Add a self-hosted application on that hostname, with a policy for the people who may read it (their email domains, or an identity provider).",
        "On the application's Overview, copy the Application Audience (AUD) tag. Enter the team name (the part before .cloudflareaccess.com) and the tag below.",
        "Set “Who may read it” to anyone who can reach it: Access decides who gets in. Enter the published address, and the site answers only there.",
        "Mark the collections for the site under Knowledge base, keep the ones that are a company's own to that company, and list each company's sign-in email domains on its edit page.",
      ],
    },

    settings: {
      language: "Language",
      languageHint: "What a reader gets before they choose for themselves.",
      defaultLanguage: "Default language",
      defaultLanguageHint: (fallback: string) =>
        `Leave this alone and the instance follows APP_LOCALE, which is ${fallback}.`,
      fromEnvironment: (fallback: string) =>
        `From the environment (${fallback})`,
      publicKb: "Public knowledge base",
      publicMoved: "Set up and watched over under",
      publicKbHint:
        "A read-only site for people who have not signed in. It shows only the collections marked for it, and nothing else in this installation.",
      publicMode: "Who may read it",
      publicModes: {
        off: "Nobody: the public site is off",
        addresses: "Only visitors from the addresses below",
        open: "Anyone who can reach it",
      },
      publicAddresses: "On-site addresses",
      publicAddressesHint:
        "One per line: an address such as 203.0.113.7, or a range such as 198.51.100.0/24. These are the public addresses your sites reach the internet from, not addresses inside your network.",
      publicUrl: "Where it is published",
      publicUrlHint:
        "Such as https://kb.example.com. The public site answers only on this hostname, so the same pages on this installation's own address stay closed. Also used for the links shown here.",
      publicYourAddress: (address: string) =>
        `You are visiting from ${address}.`,
      publicOpenWarning:
        "Anyone with the address can read every collection marked for the public site.",
      publicCollections: (count: number) =>
        count === 0
          ? "No collection is marked for the public site yet."
          : count === 1
            ? "1 collection is marked for the public site."
            : `${count} collections are marked for the public site.`,
      publicAccess: "Cloudflare Access",
      publicAccessHint:
        "When Cloudflare Access signs readers in ahead of the site, name the team and the application's audience tag here. Readers can then keep favorites and vote on articles without an account in this installation. Leave both empty otherwise.",
      publicAccessTeam: "Team",
      publicAccessTeamHint: "The part before .cloudflareaccess.com.",
      publicAccessAud: "Application audience tag",
      publicAccessAudHint:
        "From the application's Overview in Zero Trust: a long hexadecimal string.",
      publicSave: "Update public site",
      network: "Network fields",
      networkSave: "Update network fields",
      networkHint:
        "How MAC address fields write an address. A field can choose a format of its own when it is created; the rest follow this one, and addresses already saved are shown in it too.",
      domainChecks: "Automatic domain checks",
      domainChecksHint:
        "How often the worker re-runs each kind of check a domain record has turned on. A company can set its own timings for its records, and a record its own; this is what the rest follow.",
      domainIntervals: {
        off: "Never",
        day: "Every day",
        days: (days: number) => `Every ${days} days`,
      },
      domainTlsWarn: "Warn about a certificate when fewer than",
      domainTlsWarnDays: (days: number) => `${days} days`,
      domainChecksSave: "Update domain checks",
      configuration: "Configuration",
      configurationHint:
        "Set in the environment, shown here so nobody has to read a compose file.",
      storage: "Attachment storage",
      uploadLimit: "Upload limit",
      vaultMode: "Vault mode",
      sso: "Single sign-on",
      appUrl: "Public address",
      configured: "Configured",
      notConfigured: "Not configured",
    },
    branding: {
      title: "Branding",
      subtitle:
        "Your name, your logo, and one accent color, everywhere people look.",
      portalName: "Portal name",
      portalNameHint:
        "Replaces the product name in the top bar, the browser tab, and on the sign-in page.",
      accent: "Accent color",
      accentHint:
        "A hex color like #1f6feb. Used exactly as given in the mode it is for.",
      accentClear: "No accent color",
      logo: "Logo",
      logoHint:
        "PNG, JPEG, or WebP, up to 1 MB. Shown beside the name; the tab keeps the mark in your accent.",
      upload: "Upload logo",
      replace: "Replace logo",
      remove: "Remove logo",
      noLogo: "No logo yet.",
      scheme: "These assets are designed for",
      schemeHint:
        "A logo drawn for a light background disappears on a dark one, so say which this set is for.",
      lightMode: "Light mode",
      darkMode: "Dark mode",
      accentFor: (mode: string) => `Accent color for ${mode}`,
      accentTextFor: (mode: string) => `Text on the accent for ${mode}`,
      accentTextHint:
        "The color of a button's label and of text on the accent. Auto picks black or white, whichever reads.",
      auto: "Auto",
      logoFor: (mode: string) => `Logo for ${mode}`,
      currentLogo: (mode: string) => `The logo shown on ${mode}`,
      lightSection: "Light mode",
      darkSection: "Dark mode",
      colorsHint:
        "Each mode has its own accent and its own logo. A mode left without an accent gets one derived from the other, kept readable on its background.",
      altAccentHint: (mode: string) =>
        `Optional. Left empty, one is derived from your accent so it stays readable on ${mode}.`,
      altLogoHint: (mode: string) =>
        `Optional. Left empty, the other logo is shown on ${mode} too.`,
      derived: "Derived",
      kbPoweredBy: "Your name on the public knowledge base",
      kbPoweredByHint:
        "On the public knowledge base the credit reads “Powered by Trove KB | <your name>” beside your logo, in front of your customers. Leave it empty to keep the vendor's credit there too. This installation's own pages, which only your administrators and technicians see, keep reading “Powered by Trove KB | Hearne Technologies” either way.",
      kbPoweredByPlaceholder: "Your company name",
      poweredBy: "Show the “Powered by” credit",
      poweredByHint:
        "Names the product and who makes it, at the foot of every page. The license and the link to the source stay either way — anyone using this over a network is entitled to them.",
      tabIcon: "Tab icon",
      iconFor: (mode: string) => `Tab icon for ${mode}`,
      iconHint:
        "Optional. PNG, WebP, or ICO, square, 32 px or larger, up to 1 MB. Without one, the mark in your accent is the tab icon.",
      altIconHint: (mode: string) =>
        `Optional. Left empty, the other icon is shown on ${mode} too.`,
      uploadIcon: "Upload icon",
      replaceIcon: "Replace icon",
      removeIcon: "Remove icon",
      currentIcon: (mode: string) => `The tab icon shown on ${mode}`,
      noIcon: "No icon of your own; the mark in your accent stands.",
      previewHint: "Both themes, as a reader on each would see them.",
      save: "Save branding",
      preview: "Preview",
      previewButton: "A button in your color",
      companyHeading: "This company's branding",
      companyHint:
        "Shown on this company's pages and its documents. The rest of the interface keeps yours.",
    },

    docTypes: {
      title: "Doc types",
      subtitle: "Templates documents are built from.",
      empty: "No doc types yet.",
      newHeading: "New doc type",
      create: "Create doc type",
      save: "Save doc type",
      details: "Details",
      scope: "Scope",
      scopeHint:
        "Company documents attach to the company. Location documents attach to one site.",
      icon: "Icon",
      iconHint: "Shown beside the type's name wherever it appears. Search by what the picture shows.",
      chooseIcon: "Choose an icon",
      searchIcons: "Search icons",
      noIcon: "No icon",
      noIconMatches: (query: string) => `Nothing matches “${query}”.`,
      iconsShown: (shown: number, total: number) =>
        shown === total ? `${total} icons` : `${shown} of ${total} icons; search to narrow`,
      loadingIcons: "Loading icons…",
      templateFields: "Template fields",
      noFields: "No fields yet.",
      addField: "Add a template field",
      addFieldSubmit: "Add field",
      saveField: "Save field",
      archivedFields: "Archived fields",
      archivedFieldsNote:
        "Archived fields stay hidden but their stored values are kept, so old revisions still render.",
      moveUp: (label: string) => `Move ${label} up`,
      moveDown: (label: string) => `Move ${label} down`,
      linkHint:
        "Restricts the picker to documents of one type in the same company.",
      summary: (scope: string, fields: string, documents: string) =>
        `${scope} · ${fields} · ${documents}`,
    },
    optionLists: {
      title: "Option lists",
      subtitle:
        "Shared sources for dropdown fields. Any doc type can point at the same list.",
      empty: "No option lists yet.",
      listName: "List name",
      create: "Create list",
      newList: "New list",
      options: "Options",
      noOptions: "No options yet.",
      newOption: "New option",
      addOption: "Add option",
      archivedOptions: "Archived options",
      archivedNote:
        "Archived options cannot be chosen again, but documents that already hold one still show its label.",
      rename: "Rename",
      saveName: "Save name",
    },
    apiKeys: {
      title: "API keys",
      subtitle: "Bearer tokens for /api/v1. The full key is shown once.",
      existing: "Existing keys",
      empty: "No keys yet.",
      newKey: "New key",
      create: "Create key",
      revoke: "Revoke",
      revoked: "Revoked",
      delete: "Delete",
      deleteHint:
        "Removes a revoked key from this list. The audit log keeps what it did.",
      nameHint: "Where the key will be used.",
      scopes: "Scopes",
      scopeHint:
        "admin implies write, write implies read. reactions lets a key keep favorites and votes for a named reader; secrets:reveal is never implied.",
      copyNow: "Copy this key now",
      newApiKey: "New API key",
      storedNote: (prefix: string) =>
        `Only the prefix ${prefix} is stored. Trove KB keeps a SHA-256 hash, so this value cannot be shown again.`,
      lastUsed: (when: string) => `last used ${when}`,
      neverUsed: "never used",
    },
    webhooks: {
      title: "Webhooks",
      subtitle:
        "Signed with HMAC-SHA256, retried with backoff up to 8 attempts.",
      endpoints: "Endpoints",
      empty: "No webhooks yet.",
      newWebhook: "New webhook",
      url: "Endpoint URL",
      events: "Events",
      add: "Add webhook",
      enable: "Enable",
      disable: "Disable",
      signingSecret: "Signing secret",
      secretLabel: "Webhook signing secret",
      secretHint:
        "Verify X-Trove-Signature as sha256=HMAC-SHA256(secret, raw body).",
      delivered: (when: string) => `delivered ${when}`,
      retrying: (when: string) => `retrying after ${when}`,
      notDelivered: "not delivered",
    },
    vault: {
      title: "Vault",
      subtitle:
        "Trove KB stores references, never passwords. Credentials stay in the vault they already live in.",
      providers: "Providers",
      provider: "Vault",
      companyVault: "Which vault holds this client's secrets",
      companyVaultHint:
        "An MSP inherits whatever each client already uses, so a company may name its own vault.",
      defaultVault: "Instance default",
      setVault: "Set vault",
      noProvider: "No provider configured yet.",
      addProvider: "Add a provider",
      addProviderSubmit: "Add provider",
      saveProvider: "Save provider",
      mode: "Mode",
      modeHint:
        "link stores a deep link only. bw_serve brokers search, reveal, and TOTP through the sidecar.",
      webVaultUrl: "Web vault URL",
      organizationId: "Organization id",
      allowCreate: "Allow creating vault items from a document",
      enabled: "Enabled",
      collections: "Company collections",
      collectionsHint:
        "The item picker only searches collections mapped to that company.",
      collectionId: "Bitwarden collection id",
      mapCollection: "Map collection",
      unmap: "Unmap",
      noneMapped: "No collection mapped",
      brokering: (name: string) => `${name} is brokering through the sidecar.`,
      linkMode: (name: string) =>
        `${name} is in link mode, so secret fields show deep links only.`,
      degraded: (status: string) =>
        `The sidecar is ${status}, so secret fields have degraded to link mode.`,
    },
    roles: {
      title: "Roles",
      subtitle:
        "What each role may do. The three the product started with are fixed; add a role of your own with any mix of the same powers.",
      role: "Role",
      holders: "People",
      permissions: "Permissions",
      builtin: "Built in",
      builtinHint:
        "A built-in role cannot be changed or retired. A role with the administration area is an administrator in every sense: it sees every company, must keep a second factor, and is who grants access.",
      custom: "Your roles",
      newRole: "New role",
      newRoleHint:
        "Named by you, with the powers you tick. People are given it under Users.",
      key: "Key",
      keyHint:
        "How the role is named in the database and the API: lower case, letters, digits and hyphens. Made from the name unless you change it.",
      description: "Description",
      create: "Create role",
      created: "Role created.",
      save: "Save role",
      archive: "Retire role",
      inUse: (count: number) =>
        count === 1
          ? "1 person holds it; give them another role first."
          : `${count} people hold it; give them another role first.`,
      yes: "yes",
      no: "no",
      permission: {
        "hierarchy.manage": {
          name: "Companies",
          hint: "Create, edit and archive companies and locations, and set their branding and timings.",
        },
        "documents.edit": {
          name: "Documents",
          hint: "Create and edit documents, add local fields, promote them, add dropdown options, attachments, racks, schedules and domain checks.",
        },
        "doc_types.manage": {
          name: "Doc types",
          hint: "Doc types, template fields, and the shared option lists themselves.",
        },
        "secrets.fields": {
          name: "Secrets",
          hint: "Works with secret fields; revealing one still needs the per-person permission.",
        },
        "kb.write": {
          name: "KB writing",
          hint: "Write knowledge base articles in any collection without a grant.",
        },
        "admin.area": {
          name: "Admin area",
          hint: "The whole administration area. Makes the role an administrator in every sense.",
        },
      },
    },

    users: {
      title: "Users",
      subtitle:
        "Roles, company access, and who may reveal a secret from the vault.",
      roleFor: (email: string) => `Role for ${email}`,
      setRole: "Set role",
      mayReveal: "May reveal secrets",
      mayNotReveal: "Cannot reveal secrets",
      grant: "Grant",
      revoke: "Revoke",
      accessFor: (email: string) => `Company access for ${email}`,
      accessSummaryAll: "Every company",
      accessSummaryNone: "No companies",
      accessSummaryCount: (count: number) =>
        count === 1 ? "1 company" : `${count} companies`,
      adminSeesEverything: "Administrators always see every company.",

      addUser: "Add a user",
      addUserHint:
        "A local account with a temporary password, to be changed at their first sign-in. Tell them the password some other way than email.",
      temporaryPassword: "Temporary password",
      create: "Create user",
      created: (email: string) => `Created ${email}.`,
      duplicate: "A user with that email address already exists.",
      setTemporary: "Set a temporary password",
      setTemporaryHint:
        "Signs them out everywhere. They choose their own at the next sign-in.",
      temporarySet: (email: string) => `Temporary password set for ${email}.`,
      mfa: "Second step",
      mfaNone: "not enrolled",
      mfaTotp: "authenticator app",
      mfaPasskeys: (count: number) =>
        count === 1 ? "1 passkey" : `${count} passkeys`,
      mfaDue: (when: string) => `due by ${when}`,
      mfaOverdue: "overdue",
      resetMfa: "Reset second step",
      resetMfaHint:
        "For a lost phone or key. Removes everything they enrolled; they set it up again at the next sign-in.",
      resetMfaDone: (email: string) => `Second step reset for ${email}.`,
      locked: (until: string) => `Locked until ${until}`,
      unlock: "Unlock",
      unlocked: (email: string) => `Unlocked ${email}.`,
    },
    kb: {
      title: "Knowledge base",
      subtitle:
        "Collections of articles brought in from outside. One collection per source, kept apart from client documentation.",
      collections: "Collections",
      empty: "No collections yet.",
      newCollection: "New collection",
      name: "Collection name",
      nameHint: "Name it after the source, such as “Calder Ridge Support KB”.",
      description: "Description",
      descriptionHint:
        "Optional. Shown to readers, and to an AI client choosing where to search.",
      siteUrl: "Website",
      siteUrlHint:
        "Optional. Where the source lives, offered to readers who would rather go there, such as for what sits behind the vendor's sign-in. A connector's address is used when this is empty.",
      create: "Create collection",
      save: "Save collection",
      manage: "Manage",
      view: "View articles",
      settings: "Settings",
      companies: "Available to these companies only",
      companiesHint:
        "Choose none and it is available to every company. Choose some and only people and API keys with access to one of them can read it.",
      companiesAll: "Available to every company.",
      companiesOnly: (count: number) =>
        count === 1 ? "Kept to 1 company." : `Kept to ${count} companies.`,
      companiesClear: "Clear the selection",
      forEveryone: "every company",
      forSome: "selected companies only",
      columns: {
        collection: "Collection",
        articles: "Articles",
        companies: "Companies",
        visibility: "Public site visibility",
        management: "Management",
      },
      chips: {
        allCompanies: "All companies",
        someCompanies: (count: number) =>
          count === 1 ? "1 company" : `${count} companies`,
        enabled: "Enabled",
        disabled: "Disabled",
        partial: "Partial",
        partialHint: (hidden: number) =>
          hidden === 1 ? "1 article held back" : `${hidden} articles held back`,
        siteOff: "The public site is turned off under Admin → Settings.",
        notMarked: "Not marked for the public site.",
        archived: "Archived",
      },
      publicAccess: "Show on the public site",
      publicAccessHint:
        "Readable without signing in, by whoever the public site admits. Single articles can be held back from the article's own page. Nothing sensitive belongs here.",
      publicAccessOff:
        "The public site is turned off, so this has no effect yet. Turn it on under Admin → Settings.",
      onPublicSite: "on the public site",
      mcpEnabled: "Available through MCP (read only)",
      mcpEnabledHint:
        "Lets an AI client search and read this collection with an API key. Nothing can be changed through MCP.",
      archiveHint:
        "Hides the collection from readers and from search. Nothing is deleted.",
      duplicate: "A collection with that name already exists",
      visibility: {
        heading: "Public site visibility",
        hint: "What to keep off the public site. Articles held back by hand stay held back; everything else follows the rules and the categories below.",
        offHint:
          "This collection is not on the public site, so nothing here shows yet.",
        rules: "Hold back by keyword",
        rulesHint:
          "Each line is a pattern. A plain line can hold several, split by commas or tabs. Matching ignores case.",
        pattern: "Patterns",
        patternPlaceholder: "admin\ninternal, draft\n*.docx",
        regex: "Regular expressions",
        regexHint:
          "Read each pattern as a regular expression instead of a plain phrase. Commas are then part of the pattern.",
        scopeArticles: "Articles",
        scopeArticlesHint: "An article whose title matches.",
        scopeCategories: "Categories",
        scopeCategoriesHint:
          "Every article in a category or section whose name matches.",
        scopeFiles: "Files",
        scopeFilesHint:
          "An article made from a file whose name or type matches: *.pdf, docx, guide-*.pdf.",
        preview: (total: number) =>
          total === 1
            ? "Would hold back 1 article"
            : `Would hold back ${total} articles`,
        previewTitle: (n: number) => `${n} by title`,
        previewCategory: (n: number, categories: number) =>
          `${n} in ${categories === 1 ? "1 category" : `${categories} categories`}`,
        previewFile: (n: number) => `${n} by file`,
        previewPatterns: (n: number) =>
          n === 1 ? "1 pattern" : `${n} patterns`,
        previewNone: "Nothing matches yet",
        previewScope: "Choose what the patterns apply to",
        previewChecking: "Checking…",
        addRules: "Add rules",
        added: "Rules added",
        noRules: "No rules yet.",
        ruleHides: (n: number) =>
          n === 1 ? "holds back 1 article" : `holds back ${n} articles`,
        literal: "Phrase",
        remove: "Remove",
        edit: "Edit",
        editPattern: "Pattern",
        editHint: "One pattern. Matching ignores case.",
        saveRule: "Save rule",
        categories: "Category visibility",
        categoriesHint:
          "Every category is on the public site unless unchecked. An unchecked category holds back everything in it, including articles added later.",
        editCategories: "Edit category visibility",
        hideCategories: "Done",
        uncategorized: "Uncategorized",
        saveCategories: "Save category visibility",
        categoriesSaved: "Saved",
        hiddenCategories: (n: number) =>
          n === 1 ? "1 category held back" : `${n} categories held back`,
        articlesIn: (n: number) => (n === 1 ? "1 article" : `${n} articles`),
        badPattern: (pattern: string) =>
          `"${pattern}" is not a valid regular expression`,
      },
      summary: (articles: string, unextracted: number) =>
        unextracted > 0
          ? `${articles} · ${unextracted} with no readable text`
          : articles,

      importHeading: "Import",
      importHint: (mb: number) =>
        `A zip archive, a folder, or individual files: Markdown, text, PDF, and Word, with the images the articles show. Up to ${mb} MB. Importing the same source again updates its articles instead of duplicating them.`,
      importCategory: "Category for these articles",
      importCategoryHint:
        "Left empty, the folder you chose gives its name to every article that has none of its own. Type a readable name here when the folder's is not one: it becomes the category of everything in this import, and a category an article had becomes its section.",
      chooseZip: "Choose files or a zip",
      chooseFolder: "Choose a folder",
      chosen: (name: string, size: string) => `${name} · ${size}`,
      start: "Start import",
      cancel: "Cancel",
      packing: (done: number, total: number) =>
        `Packing ${done} of ${total} files…`,
      uploading: (percent: number) => `Uploading… ${percent}%`,
      importing: (count: number) => `Importing… ${count} so far`,
      tooLarge: (mb: number) =>
        `That is larger than the ${mb} MB an import accepts.`,
      nothingChosen: "Choose something to import first.",
      uploadFailed: "The upload did not finish. Try again.",
      done: "Import finished.",
      failedRun: "Import failed.",
      added: "Added",
      updated: "Updated",
      skipped: "Skipped",
      failed: "Failed",
      unextracted: "No readable text",
      images: "Images",
      ignored: "Not articles or images",
      usedManifest: "manifest.json decided what had changed.",
      failures: "What failed",
      moreFailures: "Only the first 200 are listed.",
      history: "Recent imports",
      noHistory: "Nothing has been imported yet.",
      fromUpload: "Upload",
      fromConnector: "Connector",
      status: {
        uploading: "Uploading",
        running: "Running",
        done: "Finished",
        failed: "Failed",
      },
      counts: (
        added: number,
        updated: number,
        skipped: number,
        failed: number,
      ) =>
        `${added} added · ${updated} updated · ${skipped} skipped · ${failed} failed`,

      access: "API access",
      accessHint:
        "Every collection for one key, set at once. A collection on the public site is readable by every key as the public sees it; a grant adds what is held back, or writing.",
      accessLink: "Set a key's access to every collection",
      accessKey: "API key",
      accessNoKeys: "No active API keys. Create one under Admin → API keys.",
      accessLegend:
        "D: only what its companies allow (the default for a new key). R: read. RW: read and write. Reactions: may keep favorites and votes for a named reader (on by default).",
      accessMaster: "Every collection",
      accessMasterHint: "Sets every row below; change any row afterwards.",
      accessCollection: "Collection",
      accessDefault: "D",
      accessRead: "R",
      accessWrite: "RW",
      accessReactions: "Reactions",
      accessPublicBadge: "Public",
      accessPublicNote:
        "On the public site: readable by every key as the public sees it.",
      accessSave: "Save access",
      accessSaved: (n: number) =>
        n === 0
          ? "Nothing changed."
          : n === 1
            ? "1 collection changed."
            : `${n} collections changed.`,
      accessLevelFor: (collection: string) => `Access to ${collection}`,
      accessReactionsFor: (collection: string) => `Reactions on ${collection}`,
      reactionsShort: "Reactions",
      people: "People",
      peopleHint:
        "Who may read or write this collection by name, whatever companies it is kept to. Administrators may do both without a grant.",
      noPeople: "Nobody else has an account yet.",
      peopleLevelFor: (name: string) => `Access for ${name}`,
      peopleWriters: (count: number) =>
        count === 1
          ? "1 person may write articles here."
          : `${count} people may write articles here.`,
      keys: "API key access",
      keysHint:
        "Set once per key. A key that may write keeps this collection current through the API or MCP on its own, until you change this. Keys are made under Admin → API keys.",
      keysMcpOff:
        "This collection is closed to MCP, so a key reaches it only through the REST API. Turn MCP on under Settings to open that door too.",
      noKeys: "No API keys yet. Create one under Admin → API keys.",
      levelFor: (name: string) => `Access for ${name}`,
      levels: {
        none: "Only what its companies allow",
        read: "Read",
        write: "Read and write",
      },
      saveLevel: "Save",
      writers: (count: number) =>
        count === 0
          ? "No key may write to this collection."
          : count === 1
            ? "1 key may write to this collection."
            : `${count} keys may write to this collection.`,
      setup: "Connecting a repository",
      setupHint:
        "Do this once in the repository. Afterwards its AI tooling reads and updates this collection without being asked.",
      setupConnect:
        "1. Add Trove KB as an MCP server, with a key that has access above",
      setupInstruct:
        "2. Tell the tooling when to update, in the repository's CLAUDE.md or equivalent",

      connectors: "Connectors",
      connectorsHint:
        "Reads a public knowledge base on a schedule. Public pages only: a connector signs in nowhere and follows robots.txt.",
      noConnectors: "No connectors yet.",
      addConnector: "Add a connector",
      kind: "What to read",
      kindSitemap: "A sitemap",
      kindPrefix: "Every page under an address",
      kindHelpCenter: "A help center, by its categories and sections",
      url: "Address",
      urlHintSitemap:
        "The sitemap's own address, such as https://example.com/sitemap.xml.",
      urlHintPrefix: "Pages are followed from here, and only beneath it.",
      urlHintHelpCenter:
        "The help center's front page in one language, such as https://support.example.com/hc/en-us. Each article arrives under its category and section.",
      interval: "How often, in hours",
      intervalHint: "24 for daily, 168 for weekly.",
      maxPages: "Most pages per run",
      addConnectorSubmit: "Add connector",
      runNow: "Run now",
      started: "Started. It will appear under recent imports.",
      enable: "Enable",
      disable: "Disable",
      every: (hours: number) =>
        hours % 24 === 0 ? `every ${hours / 24} d` : `every ${hours} h`,
      lastRun: (when: string) => `last run ${when}`,
      nextRun: (when: string) => `next ${when}`,
      neverRun: "never run",
      disabled: "disabled",
      unavailable:
        "Imports and connectors are not available in this deployment.",
    },
    audit: {
      title: "Audit log",
      subtitle:
        "Append-only. Every save, promotion, reveal, and key change lands here.",
      action: "Action",
      anyAction: "Any action",
      user: "User",
      anyone: "Anyone",
      from: "From",
      to: "To",
      filter: "Filter",
      clear: "Clear",
      empty: "Nothing matches those filters.",
      when: "When",
      who: "Who",
      entity: "Entity",
      detail: "Detail",
      apiKey: "API key",
      older: "Older entries",
    },
  },

  units: {
    location: "location",
    locations: "locations",
    document: "document",
    documents: "documents",
    field: "field",
    fields: "fields",
    option: "option",
    options: "options",
    result: "result",
    results: "results",
    attempt: "attempt",
    attempts: "attempts",
    article: "article",
    articles: "articles",
    page: "page",
    pages: "pages",
  },
};

export type Messages = typeof enUS;
