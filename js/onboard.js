/* ============================================================
   MODULE: js/onboard.js
   First-run welcome, Privacy / Terms, and a short "how Naluno works"
   tour. OWNERSHIP: this file. Does not touch calls or media.
   ============================================================ */

const NALUNO_WELCOME_KEY = 'nalunoWelcomeOk';
const NALUNO_TOUR_KEY = 'nalunoTourOk';
const NALUNO_LANG_KEY = 'nalunoLang';
const NALUNO_LEGAL_EFFECTIVE = '21 October 2026';

function nalunoOnboardLang(){
  try{
    const v = localStorage.getItem(NALUNO_LANG_KEY);
    if(v === 'lg' || v === 'en') return v;
  }catch(_){}
  return 'en';
}
function setNalunoOnboardLang(code){
  try{ localStorage.setItem(NALUNO_LANG_KEY, code === 'lg' ? 'lg' : 'en'); }catch(_){}
}

function nalunoWelcomeDone(){
  try{ return localStorage.getItem(NALUNO_WELCOME_KEY) === '1'; }catch(_){ return false; }
}
function nalunoTourDone(){
  try{ return localStorage.getItem(NALUNO_TOUR_KEY) === '1'; }catch(_){ return false; }
}
function stampNalunoWelcome(){
  try{ localStorage.setItem(NALUNO_WELCOME_KEY, '1'); }catch(_){}
}

/* 21 Oct e: when the Terms or Privacy Policy change in a way that matters,
   people who agreed to an older version see one short notice, once
   (Terms 16: continued use after a notice is acceptance). Never over a
   call, never before the welcome. */
const NALUNO_LEGAL_SEEN_KEY = 'nalunoLegalSeen';
const NALUNO_LEGAL_VERSION = '2026-10-21';
function nalunoLegalNoticeDue(){
  try{
    if(localStorage.getItem(NALUNO_WELCOME_KEY) !== '1') return false;
    return localStorage.getItem(NALUNO_LEGAL_SEEN_KEY) !== NALUNO_LEGAL_VERSION;
  }catch(_){ return false; }
}
function nalunoLegalNoticeBusy(){
  try{
    if(document.hidden) return true;
    if(document.body && document.body.classList.contains('naluno-gated')) return true;
    const busy = document.querySelector('.callscreen.active, #callOverlay.active, #incoming.active, #incall.active, .nl-sheet-wrap, #nalunoWelcome.active, #nalunoHello.active, #nalunoCountry.active');
    return !!busy;
  }catch(_){ return true; }
}
function showNalunoLegalNotice(){
  if(!nalunoLegalNoticeDue()) return true;
  if(nalunoLegalNoticeBusy()) return false;
  const wrap = document.createElement('div');
  wrap.className = 'nl-sheet-wrap';
  wrap.id = 'nalunoLegalNotice';
  wrap.innerHTML = '<div class="nl-sheet" role="dialog" aria-modal="true" aria-labelledby="nlLegalTitle">'
    + '<div class="nl-sheet-title" id="nlLegalTitle">We\u2019ve updated our Terms and Privacy Policy</div>'
    + '<p class="nl-sheet-sub">From 21 October 2026: you can stop someone reaching you and report a person or a Compass answer; deleted accounts are erased 30 days later; call and message records are kept 12 months; and the Terms now say plainly what is not allowed. Read the <a href="/terms" target="_blank" rel="noopener">Terms</a>, the <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a> and our <a href="/child-safety" target="_blank" rel="noopener">Child safety standards</a>.</p>'
    + '<p class="nl-sheet-sub">By carrying on using Naluno you accept them.</p>'
    + '<div class="nl-sheet-row"><button type="button" class="nl-btn" id="nlLegalOk" style="border-color:var(--mint);color:var(--mint);">OK</button></div>'
    + '</div>';
  document.body.appendChild(wrap);
  const done = function(){
    try{ localStorage.setItem(NALUNO_LEGAL_SEEN_KEY, NALUNO_LEGAL_VERSION); }catch(_){}
    try{ wrap.remove(); }catch(_){}
  };
  wrap.querySelector('#nlLegalOk').onclick = done;
  return true;
}
(function scheduleLegalNotice(){
  let tries = 0;
  const tick = function(){
    tries++;
    let shown = false;
    try{ shown = showNalunoLegalNotice(); }catch(_){ shown = true; }
    if(!shown && tries < 30) setTimeout(tick, 20000);
  };
  setTimeout(tick, 9000);
})();
function stampNalunoTour(){
  try{ localStorage.setItem(NALUNO_TOUR_KEY, '1'); }catch(_){}
}

/** Existing phones that already used Naluno should never see the new welcome. */
function nalunoIsReturningDevice(){
  try{
    if(localStorage.getItem(NALUNO_WELCOME_KEY) === '1') return true;
    if(localStorage.getItem('nalunoLastUid')) return true;
  }catch(_){}
  return false;
}

function markNalunoOnboardComplete(){
  stampNalunoWelcome();
  stampNalunoTour();
}

/* ---------------- Copy (plain language, two tongues) ---------------- */

const ONBOARD_I18N = {
  en: {
    welcomeTitle: 'Before you start',
    welcomeBefore: 'Read our ',
    welcomeMid: '. Tap “Agree and continue” to accept our ',
    welcomeAfter: '.',
    privacyLink: 'Privacy Policy',
    termsLink: 'Terms of Service',
    agree: 'Agree and continue',
    lang: 'English',
    skip: 'Skip',
    next: 'Next',
    back: 'Back',
    finish: 'Continue to sign in',
    legalBack: 'Back',
    tour: [
      {
        k: 'callsign',
        title: 'Your name here is a Callsign',
        body: 'You pick a handle — a name that is yours. No phone number. No SIM card. People who know the handle can find you. Everyone else cannot.',
      },
      {
        k: 'frequencies',
        title: 'Frequencies are people you know',
        body: 'This is your list of real connections. Tap Connect, search a handle, or stand next to someone and use Spark. Until you connect, they cannot message or call you.',
      },
      {
        k: 'wireline',
        title: 'Wireline is a private line',
        body: 'Open a person from Frequencies and you are on Wireline — messages, photos, and short clips between the two of you only. Those messages are encrypted. Naluno cannot read them.',
      },
      {
        k: 'band',
        title: 'Band is a room that does not keep the talk',
        body: 'A Band is a small group. Speak, send a clip, or go live while people are there. When the last person leaves, the gathering is wiped after 2 hours. It is not stored after that.',
      },
      {
        k: 'broadcast',
        title: 'Broadcast and Signal are what you leave on purpose',
        body: 'Broadcast is longer video you publish. Signal is a short clip that fades after about a day. Both live on the Broadcast tab at the bottom. You can put them in Strand folders, and Origin keeps your copyright with the work.',
      },
      {
        k: 'more',
        title: 'Calls, Compass, and this phone',
        body: 'Call anyone in Frequencies from their name. Compass answers questions — weather at this phone, or where this phone last pinged if you turned Find Naluno on. Find Naluno is off until you switch it on under Callsign. You are never tracked by default.',
      },
      {
        k: 'ready',
        title: 'You are ready',
        body: 'Create a handle and a password. That is your Callsign. If you already have one, sign in. After that, the bar at the bottom is the whole map: Frequencies, Wireline, Band, Broadcast, Compass, Callsign.',
      },
    ],
  },
  lg: {
    welcomeTitle: 'Tukwanirizza ku Naluno',
    welcomeBefore: 'Soma ',
    welcomeMid: '. Nyiga “Kkiriza era genda mu maaso” okukkiriza ',
    welcomeAfter: '.',
    privacyLink: 'Enteekateeka y’obukuumi',
    termsLink: 'Amateeka g’okuweereza',
    agree: 'Kkiriza era genda mu maaso',
    lang: 'Luganda',
    skip: 'Buuka',
    next: 'Ekiddako',
    back: 'Dda emabega',
    finish: 'Genda ku kuyingira',
    legalBack: 'Dda emabega',
    tour: [
      {
        k: 'callsign',
        title: 'Erinnya lyo wano lye Callsign',
        body: 'Olonda handle — erinnya eryiyo. Tewali nnamba ya ssimu. Tewali SIM. Abakimanyi basobola okukulaba. Abalala tebasobola.',
      },
      {
        k: 'frequencies',
        title: 'Frequencies be bantu be manye',
        body: 'Luno lukalala lw’abo be weegasseeko. Nyiga Connect, noonya handle, oba oyimirire wamu n’omuntu okozese Spark. Ng’onnogera, tasobola kukuwandiikira newakubadde okukuyita.',
      },
      {
        k: 'wireline',
        title: 'Wireline lulimi lwa kyama wakati wammwe bombi',
        body: 'Bwe ggulawo omuntu okuva mu Frequencies, oli ku Wireline — obubaka, ebifaananyi, n’obutambi obumpi wakati wammwe bombi. Obubaka buno bufunze. Naluno tesobola kubusoma.',
      },
      {
        k: 'band',
        title: 'Band kitundu ekitasigaza yogera',
        body: 'Band kibiina kitono. Yogera, weereza akatambi, oba otandike live ng’abantu wali. Omuntu asembayo bwe avaayo, ebyogeddwa biggibwawo oluvannyuma lw’essaawa 2. Tebisigaza.',
      },
      {
        k: 'broadcast',
        title: 'Broadcast ne Signal bye oleka nga oyagala',
        body: 'Broadcast vidiyo empanvu gy’ofulumya. Signal katambi kampi akaggwa oluvannyuma lw’olunaku. Byombi biri ku Broadcast wansi. Osobola okubiteeka mu Strand, era Origin ekukuuma copyright yo.',
      },
      {
        k: 'more',
        title: 'Calls, Compass, n’essimu eno',
        body: 'Kuba omuntu yenna mu Frequencies. Compass eddamu ebibuuzo — embeera y’obudde wano, oba essimu eno gy’esembayo okuba, bw’oba okozesezza Find Naluno. Find Naluno tewali kukola okutuusa lw’ogiteeka ku Callsign. Tewali kukugoberera nga togikkirizza.',
      },
      {
        k: 'ready',
        title: 'Olwetegekera',
        body: 'Kola handle n’ekisumuluzo. Ekyo kye Callsign yo. Bw’oba ng’olina, yingira. Oluvannyuma, akasolya wansi kwe kutegeera byonna: Frequencies, Wireline, Band, Broadcast, Compass, Callsign.',
      },
    ],
  },
};

function onboardT(){
  return ONBOARD_I18N[nalunoOnboardLang()] || ONBOARD_I18N.en;
}

/* ---------------- Icons (Naluno strokes, not a copy of another app) ---------------- */

function onboardIcon(kind){
  const stroke = '#7CFFB2';
  const mute = '#00E5FF';
  const dim = '#8B90A8';
  if(kind === 'welcome'){
    return '<svg class="onboard-hero-svg" viewBox="0 0 220 168" fill="none" aria-hidden="true">'
      + '<circle cx="110" cy="88" r="62" stroke="rgba(124,255,178,.18)" stroke-width="1.2"/>'
      + '<circle cx="110" cy="88" r="46" stroke="rgba(0,229,255,.22)" stroke-width="1.2"/>'
      + '<circle cx="110" cy="88" r="30" stroke="rgba(124,77,255,.28)" stroke-width="1.2"/>'
      + '<circle cx="110" cy="96" r="14" stroke="' + stroke + '" stroke-width="2.2"/>'
      + '<path d="M110 64v18" stroke="' + stroke + '" stroke-width="2.2" stroke-linecap="round"/>'
      + '<path d="M98 72a18 18 0 0124 0" stroke="' + mute + '" stroke-width="1.7" stroke-linecap="round"/>'
      + '<path d="M90 64a32 32 0 0140 0" stroke="#7C4DFF" stroke-width="1.4" stroke-linecap="round" opacity=".85"/>'
      + '<rect x="24" y="28" width="36" height="28" rx="8" stroke="' + dim + '" stroke-width="1.6"/>'
      + '<circle cx="36" cy="38" r="5" stroke="' + stroke + '" stroke-width="1.6"/>'
      + '<path d="M30 48c1.6-3 6-5 12-5s10.4 2 12 5" stroke="' + dim + '" stroke-width="1.6" stroke-linecap="round"/>'
      + '<path d="M168 30h18a8 8 0 018 8v10H160V38a8 8 0 018-8z" stroke="' + mute + '" stroke-width="1.6"/>'
      + '<path d="M171 30v-4a6 6 0 0112 0v4" stroke="' + mute + '" stroke-width="1.6" stroke-linecap="round"/>'
      + '<circle cx="177" cy="43" r="2.2" fill="' + stroke + '"/>'
      + '</svg>';
  }
  const wrap = function(inner){
    return '<svg class="onboard-step-svg" viewBox="0 0 80 80" fill="none" aria-hidden="true">'
      + '<circle cx="40" cy="40" r="36" stroke="rgba(124,255,178,.16)" stroke-width="1.2"/>'
      + inner + '</svg>';
  };
  if(kind === 'callsign'){
    return wrap('<circle cx="40" cy="32" r="10" stroke="' + stroke + '" stroke-width="2"/><path d="M22 58c2.5-10 10-16 18-16s15.5 6 18 16" stroke="' + stroke + '" stroke-width="2" stroke-linecap="round"/>');
  }
  if(kind === 'frequencies'){
    return wrap('<circle cx="28" cy="34" r="8" stroke="' + stroke + '" stroke-width="2"/><circle cx="52" cy="34" r="8" stroke="' + mute + '" stroke-width="2"/><path d="M16 58c1.8-8 7-13 12-13s10 5 12 13M40 58c1.8-8 7-13 12-13s10 5 12 13" stroke="' + dim + '" stroke-width="2" stroke-linecap="round"/>');
  }
  if(kind === 'wireline'){
    return wrap('<path d="M16 40h12l6-14 8 28 6-14h16" stroke="' + stroke + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>');
  }
  if(kind === 'band'){
    return wrap('<circle cx="40" cy="40" r="8" stroke="' + stroke + '" stroke-width="2"/><circle cx="22" cy="26" r="4" fill="' + mute + '"/><circle cx="58" cy="26" r="4" fill="' + mute + '"/><circle cx="40" cy="60" r="4" fill="' + stroke + '"/>');
  }
  if(kind === 'broadcast'){
    return wrap('<circle cx="40" cy="40" r="6" stroke="' + stroke + '" stroke-width="2"/><path d="M28 28a18 18 0 000 24M52 28a18 18 0 010 24M22 22a26 26 0 000 36M58 22a26 26 0 010 36" stroke="' + mute + '" stroke-width="1.7" stroke-linecap="round"/>');
  }
  if(kind === 'more'){
    return wrap('<circle cx="40" cy="40" r="18" stroke="' + stroke + '" stroke-width="2"/><path d="M48 32l-5 12-12 5 5-12 12-5z" fill="' + stroke + '"/>');
  }
  return wrap('<path d="M28 42l8 8 16-18" stroke="' + stroke + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>');
}

/* ---------------- Privacy Policy + Terms (real, matches what the app does) ---------------- */

function nalunoPrivacyHtml(){
  /* Same words as getnaluno.com/privacy. The text lives in
     js/legal-privacy.js so the app and the website change together. */
  if(typeof NALUNO_PRIVACY_HTML === 'string' && NALUNO_PRIVACY_HTML) return NALUNO_PRIVACY_HTML;
  return '<p class="legal-kicker">Effective 10 October 2026 · getnaluno.com</p><p>The Privacy Policy is on getnaluno.com/privacy.</p>';
}

function nalunoTermsHtml(){
  return ''
    + '<p class="legal-kicker">Effective ' + NALUNO_LEGAL_EFFECTIVE + ' · getnaluno.com</p>'
    + '<p>These Terms of Service are the rules for using Naluno. They are meant to be readable. By tapping “Agree and continue”, or by creating or using a Callsign, you accept them.</p>'
    + '<h3>1. The service</h3>'
    + '<p>Naluno is a communications app: a Callsign instead of a phone number, private messages (Wireline), small rooms that wipe (Band), published video (Broadcast and Signal), calls, and Compass. It is provided as-is from <strong>getnaluno.com</strong> and the Android shell of the same app.</p>'
    + '<h3>2. Who may use it</h3>'
    + '<p>You must be at least 13. If you are under the age of majority where you live, a parent or guardian must agree as well. You are responsible for the handle you pick and for keeping the password (or Google account, or recovery code) safe.</p>'
    + '<h3>3. Your Callsign</h3>'
    + '<p>A handle is unique. Do not impersonate someone else. Do not take a handle only to sell it. We may reclaim a handle that impersonates a person, a brand, or Naluno itself. One person may have more than one account only if none of them is used to harass or evade a block.</p>'
    + '<h3>4. What you may not do</h3>'
    + '<ul>'
    + '<li>Break the law, or use Naluno to plan a crime.</li>'
    + '<li>Harass, threaten, or sexually exploit anyone, especially a minor.</li>'
    + '<li>Post spam, malware, or content that is only meant to shock at scale.</li>'
    + '<li>Try to break encryption, scrape other people’s private data, or probe the service for holes in order to abuse them.</li>'
    + '<li>Pretend contribution points are money, or pretend a payment went through when it did not. Contribution points are not currency.</li>'
    + '<li>Upload video or photos you do not have the right to share.</li>'
    + '<li>Post or send any sexual content involving someone under 18, or anything that sexualises or grooms a child. We remove it, close the account, keep the evidence and report it to the authorities.</li>'
    + '<li>Post nudity or sexual content where others did not choose to see it: a Broadcast, a Signal, a profile or a live.</li>'
    + '<li>Attack people for who they are — their ethnicity, tribe, nationality, religion, sex or disability — or stir up hatred against them.</li>'
    + '<li>Threaten or encourage violence, praise or support terrorism, or recruit for a violent group.</li>'
    + '<li>Encourage someone to harm or kill themselves.</li>'
    + '</ul>'
    + '<h3>4b. Reporting and blocking</h3><p>You can stop anyone from reaching you (⋮ → Drop, and tick “Also stop them reaching me”) and report a person, a Broadcast, a Signal or a Compass answer. A person at Naluno reads every report and may remove content, limit an account or close it. The person you report is not told who reported them.</p>'
    + '<h3>5. Your content</h3>'
    + '<p>You keep the rights in what you create. Origin exists so that mark can travel with the work. When you publish a Signal, a Broadcast, a profile photo, or a message, you give Naluno a licence to host it, deliver it, and show it inside the product for as long as that item exists under the retention rules in the Privacy Policy. You can delete what the product still holds; Band after the 2-hour wipe and Signal after expiry are already gone.</p>'
    + '<h3>6. Other people’s content</h3>'
    + '<p>If someone sends you a clip, keeping a copy is your choice and your responsibility. Do not republish a private Wireline or a Band gathering as if it were yours.</p>'
    + '<h3>7. Band’s 2-hour wipe</h3>'
    + '<p>Band is not an archive. After the square has been empty for 2 hours, the conversation is deleted and cannot be retrieved from Naluno. Do not use Band for anything you must keep. Use Broadcast, your own device, or Wireline if you need a record.</p>'
    + '<h3>8. Find Naluno</h3>'
    + '<p>Find Naluno is optional and only reports <em>this</em> account’s devices. It is not a tool for watching someone else. Turning it on is your choice. Turning it off stops new pings from this phone.</p>'
    + '<h3>9. Calls and live video</h3>'
    + '<p>Only call or go live with people who expect it. Do not use a live Broadcast to surprise someone in a private place. Greenroom filters change what the other person sees of your camera; they do not hide you from a recording on their side.</p>'
    + '<h3>10. Availability</h3>'
    + '<p>We aim to keep Naluno up. We do not promise it will always work, that a call will always connect, or that a file will last forever. Phones, networks, and app stores fail. A force-close and reopen after an update is sometimes required.</p>'
    + '<h3>11. Ending the account</h3>'
    + '<p>You may sign out at any time. You may close the Callsign from Callsign. We may suspend or close an account that breaks these terms, harms others, or puts the service at risk. Deleting your account removes your Broadcasts, Signals, files and login at once, and the rest of the account 30 days later; after that it cannot be restored. An account we close for breaking these terms is kept as the record of why. Band wipes, Signal expiry, and encryption still apply — we cannot hand you a Band that has already been deleted.</p>'
    + '<h3>12. The app is not a bank, a lawyer, or emergency services</h3>'
    + '<p>Compass can be wrong. Weather is a forecast, not a guarantee. Find Naluno is last-known, not a live spy feed. If you need police, medical help, or a bank, use those services directly.</p>'
    + '<h3>13. Disclaimer</h3>'
    + '<p>Naluno is provided “as is”. To the fullest extent the law allows, we disclaim implied warranties of merchantability, fitness for a particular purpose, and non-infringement. We are not liable for lost messages, a missed call, a wipe you did not expect because you left a Band empty, or a third-party outage (Firebase, Cloudflare, a phone OS).</p>'
    + '<h3>14. Liability cap</h3>'
    + '<p>To the fullest extent the law allows, Naluno’s total liability to you for a claim about the service is limited to the amount you paid us for Naluno in the 12 months before the claim — which today is zero, because the product does not charge. Nothing in these terms limits liability that the law says cannot be limited (for example, death or personal injury caused by negligence, or fraud).</p>'
    + '<h3>15. Law</h3>'
    + '<p>These terms are governed by the laws that apply to the operator of getnaluno.com, without taking away protections your country gives you that cannot be waived. If a part of these terms cannot be enforced, the rest still stands.</p>'
    + '<h3>16. Changes</h3>'
    + '<p>We may update these terms. The date at the top will change. Continued use after a notice of a material change is acceptance of the new terms. If you do not agree, stop using Naluno and ask for the account to be closed.</p>'
    + '<h3>17. Contact</h3>'
    + '<p>Questions about these terms: <strong>naluno@getnaluno.com</strong>, the contact form on getnaluno.com, or Write to Naluno inside Compass after you sign in.</p>';
}


/* ---------------- 20 Oct c: welcome first, then the agreement, then the country ----------------
   The app used to open on the agreement: a person was asked to accept terms
   before being told what Naluno is. Now a short welcome comes first, the
   agreement second, and a country choice third (a country only — never a
   place). The country is kept on this phone until there is a Callsign, then
   saved on the profile (users/{uid}.country), and it can be changed under
   Callsign. */
const NALUNO_COUNTRY_KEY = 'nalunoCountry';
const NALUNO_COUNTRY_SAVED_KEY = 'nalunoCountrySaved';
const NALUNO_COUNTRY_CODES = ('AF AX AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW').split(' ');
const NALUNO_COUNTRY_FIRST = ['UG', 'KE', 'TZ', 'RW', 'SS', 'BI', 'CD', 'ET', 'NG', 'ZA', 'AE', 'GB', 'US'];
const NALUNO_TZ_COUNTRY = { 'Africa/Kampala': 'UG', 'Africa/Nairobi': 'KE', 'Africa/Dar_es_Salaam': 'TZ', 'Africa/Kigali': 'RW', 'Africa/Juba': 'SS', 'Africa/Bujumbura': 'BI', 'Africa/Lubumbashi': 'CD', 'Africa/Kinshasa': 'CD', 'Africa/Addis_Ababa': 'ET', 'Africa/Lagos': 'NG', 'Africa/Johannesburg': 'ZA', 'Asia/Dubai': 'AE', 'Europe/London': 'GB' };
function nalunoCountryName(code){
  try{
    if(typeof Intl !== 'undefined' && Intl.DisplayNames){
      const n = new Intl.DisplayNames([nalunoOnboardLang() === 'lg' ? 'en' : 'en'], { type: 'region' }).of(code);
      if(n && n !== code) return n;
    }
  }catch(_){}
  return code;
}
function nalunoCountryGuess(){
  try{
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if(NALUNO_TZ_COUNTRY[tz]) return NALUNO_TZ_COUNTRY[tz];
  }catch(_){}
  try{
    const m = String(navigator.language || '').match(/-([A-Z]{2})$/i);
    if(m && NALUNO_COUNTRY_CODES.indexOf(m[1].toUpperCase()) >= 0) return m[1].toUpperCase();
  }catch(_){}
  return '';
}
function nalunoValidCountry(code){
  const c = String(code || '').toUpperCase();
  return NALUNO_COUNTRY_CODES.indexOf(c) >= 0 ? c : '';
}
function nalunoChosenCountry(){
  try{ return nalunoValidCountry(localStorage.getItem(NALUNO_COUNTRY_KEY)); }catch(_){ return ''; }
}
function fillCountrySelect(sel, current){
  if(!sel) return;
  const pick = nalunoValidCountry(current) || '';
  const first = NALUNO_COUNTRY_FIRST.map(function(c){ return [c, nalunoCountryName(c)]; });
  const rest = NALUNO_COUNTRY_CODES.filter(function(c){ return NALUNO_COUNTRY_FIRST.indexOf(c) < 0; })
    .map(function(c){ return [c, nalunoCountryName(c)]; })
    .sort(function(a, b){ return a[1].localeCompare(b[1]); });
  const opt = function(p){ return '<option value="' + p[0] + '"' + (p[0] === pick ? ' selected' : '') + '>' + String(p[1]).replace(/[<&"]/g, '') + '</option>'; };
  sel.innerHTML = '<option value=""' + (pick ? '' : ' selected') + '>Choose your country</option>'
    + first.map(opt).join('') + '<option disabled>──────────</option>' + rest.map(opt).join('');
}
function setNalunoCountry(code){
  const c = nalunoValidCountry(code);
  try{
    if(c) localStorage.setItem(NALUNO_COUNTRY_KEY, c);
    else localStorage.removeItem(NALUNO_COUNTRY_KEY);
    localStorage.removeItem(NALUNO_COUNTRY_SAVED_KEY);
  }catch(_){}
  nalunoSaveCountry();
}
/* Saves the chosen country on the profile once there is a Callsign. */
async function nalunoSaveCountry(){
  try{
    if(typeof fbDb === 'undefined' || !fbDb || typeof currentUser === 'undefined' || !currentUser) return false;
    const c = nalunoChosenCountry();
    if(!c) return false;
    if(localStorage.getItem(NALUNO_COUNTRY_SAVED_KEY) === currentUser.uid + ':' + c) return true;
    await fbDb.collection('users').doc(currentUser.uid).set({ country: c, countryAt: Date.now() }, { merge: true });
    localStorage.setItem(NALUNO_COUNTRY_SAVED_KEY, currentUser.uid + ':' + c);
    return true;
  }catch(_){ return false; }
}
setInterval(function(){ nalunoSaveCountry(); }, 20000);
function showOnly(id){
  ['nalunoHello', 'nalunoWelcome', 'nalunoCountry', 'nalunoTour'].forEach(function(k){
    const el = $(k);
    if(!el) return;
    if(k === id){ el.removeAttribute('hidden'); el.classList.add('on'); }
    else { el.classList.remove('on'); el.setAttribute('hidden', ''); }
  });
  const e = onboardEls();
  window.__nalunoOnboardActive = true;
  if(e.loading) e.loading.style.display = 'none';
  if(e.form) e.form.style.display = 'none';
  if(e.gate){ e.gate.classList.add('active'); e.gate.classList.add('naluno-onboard-on'); }
  document.body.classList.add('naluno-gated');
}
function showHello(){
  showOnly('nalunoHello');
  const hero = $('helloHero');
  if(hero && !hero.getAttribute('data-drawn')){ hero.innerHTML = onboardIcon('welcome'); hero.setAttribute('data-drawn', '1'); }
  try{ if(typeof nalunoMeasureOnce === 'function') nalunoMeasureOnce('onboard', { step: 'welcome' }); }catch(_){}
}
function showCountry(){
  showOnly('nalunoCountry');
  const sel = $('countryPick');
  if(sel && !sel.options.length) fillCountrySelect(sel, nalunoChosenCountry() || nalunoCountryGuess());
  try{ if(typeof nalunoMeasureOnce === 'function') nalunoMeasureOnce('onboard', { step: 'country-shown' }); }catch(_){}
}
function wireCountryAndHello(){
  const hello = $('helloNextBtn');
  if(hello) hello.onclick = function(){ showWelcome(); };
  const next = $('countryNextBtn');
  if(next) next.onclick = function(){
    const sel = $('countryPick');
    const c = nalunoValidCountry(sel && sel.value);
    if(!c){ if(sel) sel.focus(); return; }
    setNalunoCountry(c);
    try{ if(typeof nalunoMeasureOnce === 'function') nalunoMeasureOnce('onboard', { step: 'country-chosen' }); }catch(_){}
    showTour(0);
  };
  const skip = $('countrySkipBtn');
  if(skip) skip.onclick = function(){
    try{ if(typeof nalunoMeasureOnce === 'function') nalunoMeasureOnce('onboard', { step: 'country-skipped' }); }catch(_){}
    showTour(0);
  };
  const setting = $('countrySetting');
  if(setting){
    fillCountrySelect(setting, nalunoChosenCountry());
    setting.onchange = function(){ setNalunoCountry(setting.value); };
    /* A profile that already has a country fills the setting (another phone). */
    const syncFromProfile = function(){
      try{
        const p = (typeof currentProfile !== 'undefined' && currentProfile) || null;
        const c = p && nalunoValidCountry(p.country);
        if(c && !nalunoChosenCountry()){
          localStorage.setItem(NALUNO_COUNTRY_KEY, c);
          localStorage.setItem(NALUNO_COUNTRY_SAVED_KEY, (currentUser && currentUser.uid) + ':' + c);
          fillCountrySelect(setting, c);
        }
      }catch(_){}
    };
    setInterval(syncFromProfile, 15000);
  }
}
window.nalunoChosenCountry = nalunoChosenCountry;
window.nalunoSaveCountry = nalunoSaveCountry;
window.nalunoCountryCodes = NALUNO_COUNTRY_CODES;

/* ---------------- Show / hide helpers ---------------- */

let onboardTourIndex = 0;
let onboardLegalReturn = null;

function onboardEls(){
  return {
    loading: $('authGateLoading'),
    form: $('authGateForm'),
    welcome: $('nalunoWelcome'),
    tour: $('nalunoTour'),
    legal: $('nalunoLegal'),
    gate: $('authGate'),
  };
}

function hideOnboardSurfaces(){
  ['nalunoHello', 'nalunoCountry'].forEach(function(k){ const x = $(k); if(x){ x.classList.remove('on'); x.setAttribute('hidden', ''); } });
  const e = onboardEls();
  if(e.welcome){
    e.welcome.classList.remove('on');
    e.welcome.setAttribute('hidden', '');
  }
  if(e.tour){
    e.tour.classList.remove('on');
    e.tour.setAttribute('hidden', '');
  }
}

function showAuthForm(){
  const e = onboardEls();
  hideOnboardSurfaces();
  window.__nalunoOnboardActive = false;
  if(typeof nalunoRevealSignIn === 'function'){
    nalunoRevealSignIn();
    return;
  }
  if(e.loading) e.loading.style.display = 'none';
  if(e.form) e.form.style.display = 'flex';
  if(e.gate) e.gate.classList.add('active');
  document.body.classList.add('naluno-gated');
}

function paintWelcome(){
  const t = onboardT();
  const title = $('welcomeTitle');
  const legal = $('welcomeLegal');
  const agree = $('welcomeAgreeBtn');
  const lang = $('welcomeLangLabel');
  const p = $('welcomePrivacyBtn');
  const tm = $('welcomeTermsBtn');
  if(title) title.textContent = t.welcomeTitle;
  if(legal){
    legal.innerHTML = t.welcomeBefore
      + '<button type="button" class="welcome-inline" id="welcomePrivacyBtn2">' + t.privacyLink + '</button>'
      + t.welcomeMid
      + '<button type="button" class="welcome-inline" id="welcomeTermsBtn2">' + t.termsLink + '</button>'
      + t.welcomeAfter;
    const p2 = $('welcomePrivacyBtn2');
    const t2 = $('welcomeTermsBtn2');
    if(p2) p2.onclick = function(){ openNalunoLegal('privacy'); };
    if(t2) t2.onclick = function(){ openNalunoLegal('terms'); };
  }
  if(agree) agree.textContent = t.agree;
  if(lang) lang.textContent = t.lang;
  if(p) p.textContent = t.privacyLink;
  if(tm) tm.textContent = t.termsLink;
}

function showWelcome(){
  ['nalunoHello', 'nalunoCountry'].forEach(function(k){ const x = $(k); if(x){ x.classList.remove('on'); x.setAttribute('hidden', ''); } });
  const e = onboardEls();
  window.__nalunoOnboardActive = true;
  if(e.loading) e.loading.style.display = 'none';
  if(e.form) e.form.style.display = 'none';
  if(e.tour){
    e.tour.classList.remove('on');
    e.tour.setAttribute('hidden', '');
  }
  if(e.welcome){
    e.welcome.removeAttribute('hidden');
    e.welcome.classList.add('on');
  }
  if(e.gate){
    e.gate.classList.add('active');
    e.gate.classList.add('naluno-onboard-on');
  }
  document.body.classList.add('naluno-gated');
  paintWelcome();
}

function paintTour(){
  const t = onboardT();
  const steps = t.tour;
  if(onboardTourIndex < 0) onboardTourIndex = 0;
  if(onboardTourIndex >= steps.length) onboardTourIndex = steps.length - 1;
  const step = steps[onboardTourIndex];
  const icon = $('tourIcon');
  const title = $('tourTitle');
  const body = $('tourBody');
  const next = $('tourNextBtn');
  const skip = $('tourSkipBtn');
  const back = $('tourBackBtn');
  const dots = $('tourDots');
  if(icon) icon.innerHTML = onboardIcon(step.k);
  if(title) title.textContent = step.title;
  if(body) body.textContent = step.body;
  if(skip) skip.textContent = t.skip;
  if(back){
    back.textContent = t.back;
    back.style.visibility = onboardTourIndex === 0 ? 'hidden' : 'visible';
  }
  if(next) next.textContent = (onboardTourIndex === steps.length - 1) ? t.finish : t.next;
  if(dots){
    dots.innerHTML = steps.map(function(_, i){
      return '<span class="tour-dot' + (i === onboardTourIndex ? ' on' : '') + '"></span>';
    }).join('');
  }
}

function showTour(startAt){
  ['nalunoHello', 'nalunoCountry'].forEach(function(k){ const x = $(k); if(x){ x.classList.remove('on'); x.setAttribute('hidden', ''); } });
  const e = onboardEls();
  window.__nalunoOnboardActive = true;
  onboardTourIndex = typeof startAt === 'number' ? startAt : 0;
  if(e.loading) e.loading.style.display = 'none';
  if(e.form) e.form.style.display = 'none';
  if(e.welcome){
    e.welcome.classList.remove('on');
    e.welcome.setAttribute('hidden', '');
  }
  if(e.tour){
    e.tour.removeAttribute('hidden');
    e.tour.classList.add('on');
  }
  if(e.gate){
    e.gate.classList.add('active');
    e.gate.classList.add('naluno-onboard-on');
  }
  document.body.classList.add('naluno-gated');
  paintTour();
}

function finishTour(){
  try{ if(typeof nalunoMeasureOnce === 'function') nalunoMeasureOnce('onboard', { step: onboardTourIndex >= ((onboardT().tour || []).length - 1) ? 'tour-finished' : 'tour-skipped' }); }catch(_){}
  stampNalunoTour();
  showAuthForm();
}

function openNalunoLegal(kind){
  const legal = $('nalunoLegal');
  const body = $('nalunoLegalBody');
  const title = $('nalunoLegalTitle');
  const back = $('nalunoLegalBack');
  if(!legal || !body) return;
  const t = onboardT();
  const isPrivacy = kind !== 'terms';
  if(title) title.textContent = isPrivacy ? t.privacyLink : t.termsLink;
  if(back) back.setAttribute('aria-label', t.legalBack);
  body.innerHTML = isPrivacy ? nalunoPrivacyHtml() : nalunoTermsHtml();
  body.scrollTop = 0;
  legal.classList.add('on');
  legal.removeAttribute('hidden');
  legal.setAttribute('data-kind', isPrivacy ? 'privacy' : 'terms');
}

function closeNalunoLegal(){
  const legal = $('nalunoLegal');
  if(legal){
    legal.classList.remove('on');
    legal.setAttribute('hidden', '');
  }
}

/**
 * Called from nalunoShowSignIn. Returns true if welcome or tour is showing
 * (so the sign-in form should stay hidden).
 */
function nalunoMaybeOnboard(){
  try{
    if(document.documentElement.getAttribute('data-naluno-known') === '1'){
      markNalunoOnboardComplete();
      hideOnboardSurfaces();
      return false;
    }
    if(nalunoIsReturningDevice()){
      markNalunoOnboardComplete();
      try{ document.documentElement.setAttribute('data-naluno-known', '1'); }catch(_){}
      hideOnboardSurfaces();
      return false;
    }
  }catch(_){}
  if(!nalunoWelcomeDone()){
    showHello();
    return true;
  }
  if(!nalunoTourDone()){
    showTour(0);
    return true;
  }
  return false;
}

function wireOnboard(){
  wireCountryAndHello();
  const hero = $('welcomeHero');
  if(hero && !hero.getAttribute('data-drawn')){
    hero.innerHTML = onboardIcon('welcome');
    hero.setAttribute('data-drawn', '1');
  }
  const agree = $('welcomeAgreeBtn');
  if(agree){
    agree.onclick = function(){
      stampNalunoWelcome();
      /* Agreeing now is agreeing to the current version: no "updated" notice. */
      try{ localStorage.setItem(NALUNO_LEGAL_SEEN_KEY, NALUNO_LEGAL_VERSION); }catch(_){}
      try{ if(typeof nalunoMeasureOnce === 'function') nalunoMeasureOnce('onboard', { step: 'agreed' }); }catch(_){}
      showCountry();
    };
  }
  const langBtn = $('welcomeLangBtn');
  const langMenu = $('welcomeLangMenu');
  if(langBtn){
    langBtn.onclick = function(e){
      if(e) e.stopPropagation();
      if(langMenu) langMenu.classList.toggle('on');
    };
  }
  document.addEventListener('click', function(){
    if(langMenu) langMenu.classList.remove('on');
  });
  const pickEn = $('welcomeLangEn');
  const pickLg = $('welcomeLangLg');
  if(pickEn) pickEn.onclick = function(e){
    if(e) e.stopPropagation();
    setNalunoOnboardLang('en');
    if(langMenu) langMenu.classList.remove('on');
    paintWelcome();
    if($('nalunoTour') && $('nalunoTour').classList.contains('on')) paintTour();
  };
  if(pickLg) pickLg.onclick = function(e){
    if(e) e.stopPropagation();
    setNalunoOnboardLang('lg');
    if(langMenu) langMenu.classList.remove('on');
    paintWelcome();
    if($('nalunoTour') && $('nalunoTour').classList.contains('on')) paintTour();
  };
  const pBtn = $('welcomePrivacyBtn');
  const tBtn = $('welcomeTermsBtn');
  if(pBtn) pBtn.onclick = function(){ openNalunoLegal('privacy'); };
  if(tBtn) tBtn.onclick = function(){ openNalunoLegal('terms'); };

  const skip = $('tourSkipBtn');
  const next = $('tourNextBtn');
  const back = $('tourBackBtn');
  if(skip) skip.onclick = finishTour;
  if(next) next.onclick = function(){
    const n = (onboardT().tour || []).length;
    if(onboardTourIndex >= n - 1){ finishTour(); return; }
    onboardTourIndex++;
    paintTour();
  };
  if(back) back.onclick = function(){
    if(onboardTourIndex <= 0) return;
    onboardTourIndex--;
    paintTour();
  };

  const legalBack = $('nalunoLegalBack');
  if(legalBack) legalBack.onclick = closeNalunoLegal;

  const signPrivacy = $('authPrivacyBtn');
  const signTerms = $('authTermsBtn');
  if(signPrivacy) signPrivacy.onclick = function(){ openNalunoLegal('privacy'); };
  if(signTerms) signTerms.onclick = function(){ openNalunoLegal('terms'); };
  const csP = $('callsignPrivacyBtn');
  const csT = $('callsignTermsBtn');
  if(csP) csP.onclick = function(){ openNalunoLegal('privacy'); };
  if(csT) csT.onclick = function(){ openNalunoLegal('terms'); };
}

window.nalunoMaybeOnboard = nalunoMaybeOnboard;
window.markNalunoOnboardComplete = markNalunoOnboardComplete;
window.openNalunoLegal = openNalunoLegal;
window.closeNalunoLegal = closeNalunoLegal;
window.nalunoPrivacyHtml = nalunoPrivacyHtml;
window.nalunoTermsHtml = nalunoTermsHtml;

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', wireOnboard);
} else {
  wireOnboard();
}
