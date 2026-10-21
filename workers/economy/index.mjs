import { handleRequest, runBandSweep, runLiveSweep, runLaunchGuard, runDiscoverCompile, runPushMove, runMeasureSweep, runRecordsSweep, runAccountErase } from "./handler.mjs";

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
  /* THE RULE OF BANDS: every 10 minutes, delete the conversation of every
     Band whose two hours after the last person left have run out. */
  async scheduled(event, env, ctx) {
    /* 12c: and every 10 minutes, lives whose host is gone: the creator gets a
       limelight to carry on, and after it runs out the live is stopped. */
    const job = Promise.all([
      runBandSweep(env).catch(() => null),
      runLiveSweep(env).catch(() => null),
      /* 13a: measure usage against the launch budgets and publish the guard. */
      runLaunchGuard(env).catch(() => null),
      /* 14 Oct: Discover's shared record, from the events since the last run. */
      runDiscoverCompile(env, Date.now(), 3).catch(() => null),
      /* 14 Oct: push addresses from public profiles into each vault, then done. */
      runPushMove(env).catch(() => null),
      /* 20 Oct c: measurement batches older than 180 days are deleted. */
      runMeasureSweep(env).catch(() => null),
      /* 20 Oct d: call and message records older than 12 months (unless kept for an open matter). */
      runRecordsSweep(env).catch(() => null),
      runAccountErase(env).catch(() => null),
    ]);
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(job);
    else await job;
  },
};
