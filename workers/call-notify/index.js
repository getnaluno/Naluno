import { handleRequest, VERSION } from "./handler.mjs";

export { handleRequest, VERSION };

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
