import { handleRequest, runBandSweep } from "./handler.mjs";

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
  /* THE RULE OF BANDS: every 10 minutes, delete the conversation of every
     Band whose two hours after the last person left have run out. */
  async scheduled(event, env, ctx) {
    const job = runBandSweep(env).catch(() => null);
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(job);
    else await job;
  },
};
