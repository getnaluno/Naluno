import assert from "node:assert/strict";
import { legacyCataloguePatch } from "./handler.mjs";

const now = 1_700_000_000_000;

assert.equal(legacyCataloguePatch(null), null);
assert.equal(legacyCataloguePatch({ deleted: true, createdAt: 1 }), null);
assert.equal(legacyCataloguePatch({ visibility: "private", createdAt: 1 }), null, "private is never rewritten");
assert.equal(legacyCataloguePatch({ listed: false, createdAt: 1 }), null, "an explicit hold is not listed by repair");
assert.equal(legacyCataloguePatch({ hidden: true, createdAt: 1 }), null);
assert.equal(legacyCataloguePatch({ held: true, createdAt: 1 }), null);
assert.equal(legacyCataloguePatch({
  visibility: "public", listed: true, hidden: false, held: false, publishAt: 10,
}), null, "a complete public Broadcast is left alone");

const legacy = legacyCataloguePatch({ title: "Old", createdAt: now - 1000 }, now);
assert.deepEqual(legacy, {
  visibility: "public",
  listed: true,
  hidden: false,
  held: false,
  publishAt: now - 1000,
});

const partial = legacyCataloguePatch({
  visibility: "public", listed: true, hidden: false, held: false, createdAt: now - 50,
}, now);
assert.deepEqual(partial, { publishAt: now - 50 }, "only the missing clock is filled");

assert.equal(legacyCataloguePatch({ createdAt: now + 5000 }, now).publishAt, undefined);
