import { handleRequest, runBandSweep } from "./handler.mjs";

export { handleRequest, parseServiceAccount, signRs256Jwt, VERSION } from "./handler.mjs";

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    const job = runBandSweep(env).catch(() => null);
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(job);
    else await job;
  },
};
