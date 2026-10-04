/**
 * Uganda mobile money beside Stripe.
 * A request stays pending until a signed notice matches the stored intent.
 * The phone cannot mark itself paid.
 */
export function createMomoRail(d) {
  const {
    json, fsGetDoc, fsPutDoc, fetchImpl, validateCheckout, momoPayer, momoCollectBody, momoNoticeValid,
    normCode, priceIn, roundForCharge, majorToStripe, closeEnough, loadRates, loadPriceBook, readFlags, markPaid,
    momoDisburseDecision,
  } = d;

  async function quoteForMomo(env, user, saToken, body, check) {
    const payCur = normCode(check.currency);
    const rates = await loadRates(env, saToken);
    let charge = null;
    let bookAmount = null;
    let bookCurrency = "";
    if (check.kind === "support") {
      const flags = await readFlags(env, saToken, null);
      if (!flags.flags.creator_support_enabled) {
        return { error: "Creator Support is off. Nothing was charged.", http: 403 };
      }
      const major = roundForCharge(check.amountMajor, payCur);
      const got = payCur === "UGX"
        ? { major, currency: "UGX", stripe: majorToStripe(major, "UGX") }
        : priceIn({ amount: major, currency: payCur }, "UGX", rates);
      if (got.error) return { error: "Exchange rates are not available right now. Nothing was charged.", http: 503 };
      charge = got;
    }
    if (check.kind === "ad") {
      const adId = String(body.ad_id || "");
      const mailId = String(body.mail_id || "");
      const doc = adId
        ? await fsGetDoc(env, saToken, "/deskAds/" + encodeURIComponent(adId))
        : await fsGetDoc(env, saToken, "/deskMail/" + encodeURIComponent(mailId));
      if (!doc) return { error: "This ad is not on file. Nothing was charged.", http: 404 };
      const owner = String(doc.creatorUid || doc.uid || "");
      if (owner && owner !== user.uid) return { error: "This ad is not yours.", http: 403 };
      const booked = Number(doc.paidAed) || 0;
      if (!(booked > 0)) return { error: "There is no amount to pay. Nothing was charged.", http: 400 };
      const got = priceIn({ amount: booked, currency: "AED" }, "UGX", rates);
      if (got.error) return { error: "Exchange rates are not available right now. Nothing was charged.", http: 503 };
      charge = got;
      bookAmount = booked;
      bookCurrency = "AED";
    }
    if (check.kind === "known") {
      const app = await fsGetDoc(env, saToken, "/knownApps/" + encodeURIComponent(user.uid));
      if (!app || (app.status !== "accepted" && app.status !== "known" && app.status !== "lapsed")) {
        return { error: "This has not been accepted yet. Nothing was charged.", http: 403 };
      }
      const book = await loadPriceBook(env, saToken);
      if (!book.known) return { error: "The Known price is not set yet. Nothing was charged.", http: 503 };
      const shownCur = priceIn(book.known, payCur, rates);
      if (shownCur.error) return { error: "Exchange rates are not available right now. Nothing was charged.", http: 503 };
      const shown = Number(body.amount_major);
      if (shown > 0 && !closeEnough(shown, shownCur.major, 0.05)) {
        return {
          error: "The price was updated. Check it and tap again. Nothing was charged.",
          http: 409, code: "price_changed", amount_major: shownCur.major, currency: shownCur.currency,
        };
      }
      const got = priceIn(book.known, "UGX", rates);
      if (got.error) return { error: "Exchange rates are not available right now. Nothing was charged.", http: 503 };
      charge = got;
      bookAmount = book.known.amount;
      bookCurrency = book.known.currency;
    }
    if (!charge || !(charge.major > 0)) return { error: "That amount cannot be charged. Nothing was charged.", http: 400 };
    return { charge, bookAmount, bookCurrency };
  }

  async function payMomo(env, user, saToken, body) {
    if (!saToken) return json({ ok: false, code: "not_connected", paid: false, error: "Payments are not connected yet. Nothing was charged." }, 503);
    const payer = momoPayer(body || {});
    if (payer.error) return json({ ok: false, paid: false, status: "unpaid", error: payer.error }, 400);
    const check = validateCheckout(body, user.uid);
    if (check.error) return json({ ok: false, paid: false, error: check.error }, 400);
    const quote = await quoteForMomo(env, user, saToken, body, check);
    if (quote.error) {
      return json({
        ok: false, paid: false, error: quote.error,
        code: quote.code || "", amount_major: quote.amount_major || 0, currency: quote.currency || "",
      }, quote.http || 400);
    }
    const rawKey = String((body && body.idempotency_key) || ("t" + Date.now().toString(36))).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
    const id = ("mm" + rawKey).slice(0, 72);
    const existing = await fsGetDoc(env, saToken, "/payments/" + encodeURIComponent(id));
    const supportId = check.kind === "support" ? String(body.idempotency_key || id).slice(0, 120) : "";
    const reference = id.slice(-8).toUpperCase();
    if (!existing) {
      await fsPutDoc(env, saToken, "/payments/" + encodeURIComponent(id), {
        status: "pending",
        provider: "momo",
        kind: check.kind,
        amount_major: quote.charge.major,
        amount_minor: quote.charge.stripe,
        currency: "UGX",
        expected_amount: quote.charge.stripe,
        expected_currency: "UGX",
        stripe_amount: quote.charge.stripe,
        book_amount: quote.bookAmount || 0,
        book_currency: quote.bookCurrency || "",
        payer_uid: user.uid,
        creator_user_id: String(body.creator_user_id || ""),
        ad_id: String(body.ad_id || ""),
        mail_id: String(body.mail_id || ""),
        broadcast_id: String(body.broadcast_id || ""),
        support_id: supportId,
        network: payer.network,
        phone: payer.phone,
        phone_tail: payer.tail,
        reference: reference,
        createdAt: Date.now(),
      });
      await fsPutDoc(env, saToken, "/users/" + encodeURIComponent(user.uid) + "/payStatus/" + encodeURIComponent(id), {
        status: "pending",
        paid: false,
        kind: check.kind,
        amount_major: quote.charge.major,
        currency: "UGX",
        network: payer.network,
        phone_tail: payer.tail,
        reference: reference,
        at: Date.now(),
      });
    }
    let collected = false;
    if (!existing && env.MOMO_COLLECTIONS_URL && env.MOMO_COLLECTIONS_KEY) {
      try {
        const res = await fetchImpl(String(env.MOMO_COLLECTIONS_URL), {
          method: "POST",
          headers: {
            Authorization: "Bearer " + env.MOMO_COLLECTIONS_KEY,
            "Content-Type": "application/json",
            "X-Reference-Id": id,
            "X-Target-Environment": env.MOMO_TARGET_ENV || (payer.network === "airtel" ? "airteluganda" : "mtnuganda"),
          },
          body: JSON.stringify(momoCollectBody({
            id: id,
            amount_major: quote.charge.major,
            currency: "UGX",
            phone: payer.phone,
            kind: check.kind,
          })),
        });
        collected = !!(res && res.ok);
      } catch (_) { collected = false; }
    }
    const ref = (existing && existing.reference) || reference;
    const already = existing && existing.status === "paid";
    return json({
      ok: true,
      paid: false,
      status: "pending",
      rail: "momo",
      intent_id: id,
      reference: ref,
      amount_major: quote.charge.major,
      currency: "UGX",
      network: payer.network,
      phone_tail: payer.tail,
      collected: collected,
      message: already
        ? "This was already confirmed. Nothing new was taken."
        : (collected
          ? "Approve the prompt on your phone. Nothing is marked paid until MTN or Airtel confirms. Reference " + ref + "."
          : "Naluno recorded this request. The mobile-money line is not connected yet, so nothing was taken. It stays unpaid until a confirmed notice arrives. Reference " + ref + "."),
    });
  }

  async function payMomoNotice(env, request, saToken) {
    if (!saToken || !env.MOMO_NOTICE_SECRET) return json({ ok: false, paid: false }, 503);
    const raw = await request.text();
    const sig = request.headers.get("X-Naluno-Momo") || "";
    let peek = null;
    try { peek = JSON.parse(raw); } catch (_) { return json({ ok: false }, 400); }
    const id = String((peek && peek.intent_id) || "");
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) return json({ ok: false }, 400);
    const intent = await fsGetDoc(env, saToken, "/payments/" + encodeURIComponent(id));
    if (!intent || intent.provider !== "momo") return json({ ok: false }, 404);
    const ok = await momoNoticeValid(raw, sig, env.MOMO_NOTICE_SECRET, intent);
    if (!ok) return json({ ok: false, paid: false }, 400);
    if (intent.status === "paid") return json({ ok: true, already: true });
    await markPaid(env, saToken, {
      id: id,
      provider: "momo",
      kind: intent.kind,
      amount_minor: intent.amount_minor,
      amount_major: intent.amount_major,
      currency: intent.currency,
      stripe_amount: intent.stripe_amount || intent.expected_amount,
      expected_amount: intent.expected_amount,
      expected_currency: intent.expected_currency,
      book_amount: intent.book_amount || 0,
      book_currency: intent.book_currency || "",
      payer_uid: intent.payer_uid,
      creator_user_id: intent.creator_user_id,
      ad_id: intent.ad_id,
      mail_id: intent.mail_id,
      broadcast_id: intent.broadcast_id,
      support_id: intent.support_id,
    });
    if (intent.payer_uid) {
      await fsPutDoc(env, saToken, "/users/" + encodeURIComponent(intent.payer_uid) + "/payStatus/" + encodeURIComponent(id), {
        status: "paid",
        paid: true,
        at: Date.now(),
      });
    }
    return json({ ok: true, status: "paid" });
  }

  function disburseError(code) {
    if (code === "phase_off") return "Monetisation is not on. Nothing was sent.";
    if (code === "not_eligible") return "This account is not on the monetisation list. Nothing was sent.";
    if (code === "no_method") return "Save an MTN or Airtel number first. Nothing was sent.";
    return "Mobile money payouts are not connected yet. Nothing was sent.";
  }

  /* Creator receive rail. Uganda MTN / Airtel. Never marks paid.
     Separate from Creator Support collections. */
  async function disburseMomo(env, user, saToken) {
    if (!user || !user.uid) {
      return json({ ok: false, paid: false, status: "unpaid", code: "sign_in", error: "Sign in. Nothing was sent." }, 401);
    }
    if (!saToken) {
      return json({
        ok: false, paid: false, status: "unpaid", code: "not_connected", rail: "momo", kind: "monetisation",
        error: "Mobile money payouts are not connected yet. Nothing was sent.",
      }, 503);
    }
    const flags = await readFlags(env, saToken, null);
    const phaseOn = !!(flags && flags.flags && flags.flags.monetisation_phase_enabled);
    const mark = await fsGetDoc(env, saToken, "/creatorMonetisation/" + encodeURIComponent(user.uid));
    const method = await fsGetDoc(env, saToken, "/creatorPayoutMethods/" + encodeURIComponent(user.uid));
    const decision = (typeof momoDisburseDecision === "function" ? momoDisburseDecision : function () {
      return { ok: false, paid: false, status: "unpaid", code: "not_connected" };
    })({
      phaseOn: phaseOn,
      eligible: !!(mark && mark.eligible === true),
      method: method,
      disburseUrl: env && env.MOMO_DISBURSE_URL,
    });
    if (decision.paid) decision.paid = false;
    if (!decision.ok) {
      return json({
        ok: false,
        paid: false,
        status: "unpaid",
        code: decision.code || "not_connected",
        rail: "momo",
        kind: "monetisation",
        error: disburseError(decision.code),
      }, decision.code === "not_connected" ? 503 : 403);
    }
    let submitted = false;
    try {
      const res = await fetchImpl(String(env.MOMO_DISBURSE_URL), {
        method: "POST",
        headers: {
          Authorization: "Bearer " + String(env.MOMO_DISBURSE_KEY || ""),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phone: method.phone,
          network: decision.network,
          currency: "UGX",
          externalId: "mn" + String(user.uid).slice(0, 40),
          kind: "monetisation",
        }),
      });
      submitted = !!(res && res.ok);
    } catch (_) { submitted = false; }
    await fsPutDoc(env, saToken, "/users/" + encodeURIComponent(user.uid) + "/payStatus/monetise", {
      status: submitted ? "submitted" : "unpaid",
      paid: false,
      kind: "monetisation",
      rail: "momo",
      network: decision.network || "",
      phone_tail: decision.phone_tail || "",
      at: Date.now(),
    });
    return json({
      ok: submitted,
      paid: false,
      status: submitted ? "submitted" : "unpaid",
      code: submitted ? "submitted" : "not_connected",
      rail: "momo",
      kind: "monetisation",
      message: submitted
        ? "The mobile-money line accepted a request. It is not marked paid until MTN or Airtel confirms."
        : "The mobile-money line did not accept it. Nothing was marked paid.",
    }, submitted ? 200 : 503);
  }

  return { payMomo, payMomoNotice, disburseMomo };
}
