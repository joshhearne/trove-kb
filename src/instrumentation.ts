/**
 * The in-process worker: a timer polling webhook_deliveries, which is what
 * docs/ARCHITECTURE.md asks for instead of a queue service. It also looks for
 * schedules that have come due, far less often, since a date changes once a day.
 */
const INTERVAL_MS = 15_000;
/**
 * A due date changes once a day, so a quarter of an hour is often enough.
 * Configurable because a test wants to see it happen without waiting.
 */
const SCHEDULE_INTERVAL_MS =
  Number(process.env.SCHEDULE_POLL_SECONDS ?? 900) * 1000 || 15 * 60_000;

declare global {
  var __troveWebhookWorker: NodeJS.Timeout | undefined;
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // On Workers a Cron Trigger drives delivery; there is no long-lived process
  // to hold a timer.
  const { isWorkers } = await import("@/lib/runtime");
  if (isWorkers()) return;

  // What's new: record the change files this build brings in, or drop the
  // ones a rollback took away. Every replica may; the sync takes a lock.
  // Never holds up startup.
  const { syncChanges } = await import("@/server/services/whats-new");
  void syncChanges()
    .then(({ added, removed }) => {
      if (added || removed) console.log(`trove-kb: what's new: ${added} new, ${removed} removed`);
    })
    .catch((error) => console.error("trove-kb: what's new sync failed", error));

  if (process.env.TROVE_DISABLE_WEBHOOK_WORKER === "true") return;
  if (globalThis.__troveWebhookWorker) return;

  const { deliverDueWebhooks } = await import("@/server/services/webhooks");
  const { announceDue } = await import("@/server/services/schedules");
  const { runDueDomainChecks } = await import("@/server/services/domain-checks");

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await deliverDueWebhooks();
    } catch (error) {
      console.error("trove-kb: webhook worker failed", error);
    } finally {
      running = false;
    }
  };

  let announcing = false;
  const announce = async () => {
    if (announcing) return;
    announcing = true;
    try {
      await announceDue();
    } catch (error) {
      console.error("trove-kb: schedule worker failed", error);
    }
    // Domain checks come round on the same cadence: a certificate or a name
    // server does not change by the minute either.
    try {
      await runDueDomainChecks();
    } catch (error) {
      console.error("trove-kb: domain check worker failed", error);
    } finally {
      announcing = false;
    }
  };

  // Knowledge base: an import lives in this process, so whatever was running
  // when the last one stopped is over, and connectors are checked on a timer.
  const { failInterruptedImports } = await import("@/server/services/kb-import");
  const { clearScratch } = await import("@/server/services/kb-upload");
  const { runDueConnectors } = await import("@/server/services/kb-connectors");
  void failInterruptedImports()
    .then(() => clearScratch())
    .catch((error) => console.error("trove-kb: knowledge base cleanup failed", error));

  let crawling = false;
  const crawl = async () => {
    if (crawling) return;
    crawling = true;
    try {
      await runDueConnectors();
    } catch (error) {
      console.error("trove-kb: knowledge base connectors failed", error);
    } finally {
      crawling = false;
    }
  };
  const connectorTimer = setInterval(
    () => void crawl(),
    Number(process.env.KB_CONNECTOR_POLL_SECONDS ?? 300) * 1000 || 300_000,
  );
  connectorTimer.unref();

  const timer = setInterval(() => void tick(), INTERVAL_MS);
  const scheduleTimer = setInterval(() => void announce(), SCHEDULE_INTERVAL_MS);
  // Never hold the process open just for the pollers.
  timer.unref();
  scheduleTimer.unref();
  globalThis.__troveWebhookWorker = timer;

  // Once at boot, so a fresh container does not wait a quarter of an hour.
  void announce();

  console.log("trove-kb: webhook worker started");
}
