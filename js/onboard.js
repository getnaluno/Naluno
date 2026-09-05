/* ============================================================
   MODULE: js/onboard.js
   First-run welcome, Privacy / Terms, and a short "how Naluno works"
   tour. OWNERSHIP: this file. Does not touch calls or media.
   ============================================================ */

const NALUNO_WELCOME_KEY = 'nalunoWelcomeOk';
const NALUNO_TOUR_KEY = 'nalunoTourOk';
const NALUNO_LANG_KEY = 'nalunoLang';
const NALUNO_LEGAL_EFFECTIVE = '5 September 2026';

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
    welcomeTitle: 'Welcome to Naluno',
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
  return ''
    + '<p class="legal-kicker">Effective ' + NALUNO_LEGAL_EFFECTIVE + ' · getnaluno.com</p>'
    + '<p>This Privacy Policy explains what Naluno collects, why, who can see it, and how long it stays. It is written in ordinary language on purpose. If a sentence here does not match what the app actually does, the app is wrong — not this page — and we will correct the app.</p>'
    + '<h3>1. Who we are</h3>'
    + '<p>Naluno is the service at <strong>getnaluno.com</strong>. It is a place to be reachable without handing over a phone number. This policy applies to the website, the installable web app, and the Android shell of the same app.</p>'
    + '<h3>2. What this app is not</h3>'
    + '<p>Naluno does not ask for a phone number or a SIM card. It does not sell your personal information. Contribution points inside the app are not money and are not a payment. Creator Support is not live: nothing is charged today.</p>'
    + '<h3>3. The account you create</h3>'
    + '<p>To use Naluno you create a Callsign. That can be:</p>'
    + '<ul>'
    + '<li>a handle and password (no email required), with an optional recovery email in case you forget the password, or</li>'
    + '<li>Google sign-in, or</li>'
    + '<li>an email and password.</li>'
    + '</ul>'
    + '<p>Sign-in is provided by <strong>Google Firebase Authentication</strong>. We store your user id, display name, handle, tagline, avatar, colour, and the settings you choose (for example Greenroom filters, a Compass lock, Find Naluno on or off). We do not receive your Google password.</p>'
    + '<h3>4. People you connect with</h3>'
    + '<p>Frequencies are connections you make on purpose — search a handle, accept a request, or Spark in person. We store those connections so both of you can see each other, message, and call. We do not scrape your phone’s address book.</p>'
    + '<h3>5. Messages</h3>'
    + '<p><strong>Wireline</strong> (one-to-one) uses end-to-end encryption. The text of those messages is stored in a form we cannot read. We can still see that a conversation exists, who the two people are, and roughly when something was sent. Photos and clips you send on Wireline are held so they can be delivered, then follow the same access rules as the thread.</p>'
    + '<p><strong>Band</strong> is a shared room. While people are in the square, messages and clips are stored so everyone there can see them. When the last person leaves, the gathering is <strong>deleted after 2 hours</strong>. After that wipe, those messages are removed and are not readable. That is the design, not a hide.</p>'
    + '<h3>6. Video and photos you publish</h3>'
    + '<p><strong>Signal</strong> is a short clip. It is meant to fade. Media is stored for about a day and then removed from storage.</p>'
    + '<p><strong>Broadcast</strong> is longer video you leave on purpose. It stays until you delete it. Live video is a real-time call between devices; Naluno does not keep a copy of the live picture as a file unless you publish a Broadcast.</p>'
    + '<p>Media files are stored on <strong>Cloudflare R2</strong> through Naluno’s own upload workers. Your profile photo is stored so it can be shown wherever your Callsign appears.</p>'
    + '<p><strong>Origin</strong> is how you mark that a work is yours. Copyright in what you create stays with you. Publishing on Naluno is a licence for us to host and show that work inside Naluno, not a transfer of ownership.</p>'
    + '<h3>7. Calls</h3>'
    + '<p>A call uses WebRTC between the two phones. The picture and sound of the call are not stored by Naluno. We do store what is needed to connect you: that a call was placed, who called whom, and signalling so the phones can find each other. Incoming-call alerts use <strong>Firebase Cloud Messaging</strong> if you allow notifications. You can turn that off.</p>'
    + '<h3>8. Location</h3>'
    + '<p>Location is <strong>off unless you turn it on</strong>.</p>'
    + '<p><strong>Find Naluno</strong> (under Callsign) is only for <em>your</em> devices on <em>your</em> account. When it is on, this phone sends a ping — coordinates, a rough accuracy, a place name, a time — so you can see the last place from another signed-in device. We do not publish that ping to other people. Turn it off and this phone stops reporting. A phone that is off can only show its last ping.</p>'
    + '<p><strong>Weather</strong> on the strip and in Compass uses this phone’s place so the reading matches where you are, not a city we guessed. Coordinates are sent to <strong>Open-Meteo</strong> (forecast) and a reverse-geocoder (place name). We do not build a location history for weather.</p>'
    + '<h3>9. Compass</h3>'
    + '<p>Compass is a private notebook plus an assistant. Messages you type there are stored on your account so the thread is still there when you reopen it. You can lock Compass with a password on the device. Weather and Find answers use the live data described above. The assistant runs on a Naluno worker; do not put secrets in Compass that you would not want processed to produce a reply.</p>'
    + '<h3>10. Diagnostics</h3>'
    + '<p>The app keeps a short error log on this device so a break can be copied and sent. That log does not upload by itself. It lives under the hidden Admin Console, not on Callsign.</p>'
    + '<h3>11. Who we share with (processors)</h3>'
    + '<p>We use other companies to run the service, not to sell your data:</p>'
    + '<ul>'
    + '<li><strong>Google Firebase</strong> — accounts, database, push alerts.</li>'
    + '<li><strong>Cloudflare</strong> — file storage for Signal and Broadcast, and some edge workers.</li>'
    + '<li><strong>Open-Meteo</strong> — weather for the coordinates this phone just used.</li>'
    + '<li><strong>BigDataCloud</strong> (and sometimes OpenStreetMap Nominatim) — turning coordinates into a place name.</li>'
    + '<li>A TURN/STUN provider — so a call can connect when a direct path fails.</li>'
    + '</ul>'
    + '<p>They only receive what that job needs. We do not sell lists of people. We do not put your Callsign on a public people-search engine.</p>'
    + '<h3>12. How long we keep it</h3>'
    + '<ul>'
    + '<li>Account and Callsign — until you delete the account or we close it for abuse.</li>'
    + '<li>Wireline — while the thread exists; bodies stay encrypted.</li>'
    + '<li>Band — deleted about 2 hours after the room is empty.</li>'
    + '<li>Signal media — about 25 hours.</li>'
    + '<li>Broadcast — until you delete it.</li>'
    + '<li>Find Naluno pings — replaced by the next ping; stop when you turn it off.</li>'
    + '<li>Compass — until you clear it or delete the account.</li>'
    + '</ul>'
    + '<h3>13. Your choices</h3>'
    + '<p>You can edit Callsign, remove a photo, turn Find Naluno off, hide the weather strip, lock Compass, refuse notifications, and sign out. You can ask us to delete an account through Compass or getnaluno.com. Some copies (for example a Signal already expired, or a Band already wiped) are already gone.</p>'
    + '<h3>14. Children</h3>'
    + '<p>Naluno is not for children under 13. If you are 13–17, use it only with a parent or guardian’s permission where your country requires that.</p>'
    + '<h3>15. Security</h3>'
    + '<p>We use HTTPS, Firebase rules that block other people from reading your private documents, and encryption on Wireline. No app is unbreakable. Protect your password. If you use Google sign-in, you will be shown a recovery code for your encrypted messages — write it down. We cannot reset that for you.</p>'
    + '<h3>16. Outside your country</h3>'
    + '<p>Firebase, Cloudflare, and the weather services may process data in the United States or other countries. If you use Naluno, you understand that your information may leave the country you are standing in, with the protections those providers publish.</p>'
    + '<h3>17. Changes</h3>'
    + '<p>If this policy changes in a way that matters, we will update the date at the top and, when the change is large, show a notice in the app. The current text is always inside Naluno.</p>'
    + '<h3>18. How to reach us</h3>'
    + '<p>Use Compass after you sign in, or the site <strong>getnaluno.com</strong>. Say that your message is about privacy so it is treated as one.</p>';
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
    + '<li>Pretend Naluno collects money from you or pays you. Contribution points are not currency. Payments are not live.</li>'
    + '<li>Upload video or photos you do not have the right to share.</li>'
    + '</ul>'
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
    + '<p>You may sign out at any time. You may ask for the account to be deleted. We may suspend or close an account that breaks these terms, harms others, or puts the service at risk. Band wipes, Signal expiry, and encryption still apply — we cannot hand you a Band that has already been deleted.</p>'
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
    + '<p>Questions about these terms: Compass after you sign in, or <strong>getnaluno.com</strong>.</p>';
}

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
  const e = onboardEls();
  if(e.welcome) e.welcome.classList.remove('on');
  if(e.tour) e.tour.classList.remove('on');
}

function showAuthForm(){
  const e = onboardEls();
  hideOnboardSurfaces();
  window.__nalunoOnboardActive = false;
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
  const e = onboardEls();
  window.__nalunoOnboardActive = true;
  if(e.loading) e.loading.style.display = 'none';
  if(e.form) e.form.style.display = 'none';
  if(e.tour) e.tour.classList.remove('on');
  if(e.welcome) e.welcome.classList.add('on');
  if(e.gate) e.gate.classList.add('active');
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
  const e = onboardEls();
  window.__nalunoOnboardActive = true;
  onboardTourIndex = typeof startAt === 'number' ? startAt : 0;
  if(e.loading) e.loading.style.display = 'none';
  if(e.form) e.form.style.display = 'none';
  if(e.welcome) e.welcome.classList.remove('on');
  if(e.tour) e.tour.classList.add('on');
  if(e.gate) e.gate.classList.add('active');
  document.body.classList.add('naluno-gated');
  paintTour();
}

function finishTour(){
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
  legal.setAttribute('data-kind', isPrivacy ? 'privacy' : 'terms');
}

function closeNalunoLegal(){
  const legal = $('nalunoLegal');
  if(legal) legal.classList.remove('on');
}

/**
 * Called from nalunoShowSignIn. Returns true if welcome or tour is showing
 * (so the sign-in form should stay hidden).
 */
function nalunoMaybeOnboard(){
  try{
    if(nalunoIsReturningDevice()){
      markNalunoOnboardComplete();
      return false;
    }
  }catch(_){}
  if(!nalunoWelcomeDone()){
    showWelcome();
    return true;
  }
  if(!nalunoTourDone()){
    showTour(0);
    return true;
  }
  return false;
}

function wireOnboard(){
  const hero = $('welcomeHero');
  if(hero && !hero.getAttribute('data-drawn')){
    hero.innerHTML = onboardIcon('welcome');
    hero.setAttribute('data-drawn', '1');
  }
  const agree = $('welcomeAgreeBtn');
  if(agree){
    agree.onclick = function(){
      stampNalunoWelcome();
      showTour(0);
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
