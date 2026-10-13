/* 14 Oct — push addresses leave the public profile.

   Both push workers read each person's private vault (users/{uid}/vault/main).
   The phone now writes there only. For addresses written before, the cron
   copies what the vault is missing and removes the public copy, in one
   commit per person, a page of profiles per run, keeping its place in
   pushMove/state. Nothing else on the profile is touched.

   io: { state() -> { pageToken, done }, page(token, size) -> { users:[{id, data}], next },
         vault(uid) -> data|null, commit(uid, vaultPatch, removeKeys) -> bool, save(state) } */
export const PUSH_KEYS = ["fcmToken", "fcmTokenWeb", "fcmTokenAndroid", "fcmTokenPlatform", "fcmTokenUpdatedAt"];
const SECRET = ["fcmToken", "fcmTokenWeb", "fcmTokenAndroid"];

export async function movePushPage(io, size) {
  const st = (await io.state()) || {};
  if (st.done) return { done: true, moved: 0, checked: 0 };
  const page = await io.page(st.pageToken || "", Math.max(1, Math.min(100, size || 100)));
  let moved = 0, checked = 0;
  for (const u of (page.users || [])) {
    const d = u.data || {};
    if (!SECRET.some((k) => typeof d[k] === "string" && d[k])) continue;
    checked++;
    const v = (await io.vault(u.id)) || {};
    const patch = {};
    PUSH_KEYS.forEach((k) => { if (d[k] != null && d[k] !== "" && (v[k] == null || v[k] === "")) patch[k] = d[k]; });
    const ok = await io.commit(u.id, patch, SECRET.filter((k) => k in d));
    if (ok) moved++;
  }
  const next = page.next || "";
  await io.save({ pageToken: next, done: !next, at: Date.now() });
  return { done: !next, moved, checked };
}
