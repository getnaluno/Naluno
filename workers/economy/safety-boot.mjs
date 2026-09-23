import * as Safety from "./safety.mjs";

const api = {
  scorePublicText: Safety.scorePublicText,
  scoreBehaviour: Safety.scoreBehaviour,
  matchKnownHash: Safety.matchKnownHash,
  combineRisk: Safety.combineRisk,
  buildCase: Safety.buildCase,
  buildAppeal: Safety.buildAppeal,
  statementFor: Safety.statementFor,
  fingerprintPublic: Safety.fingerprintPublic,
  SAFETY_VERSION: Safety.SAFETY_VERSION,
};
try { window.NalunoSafety = api; } catch (_) {}
export default api;
