/* ============================================================
   MODULE: js/compass-brain.js   (30a)
   What Compass knows about Naluno, and how it decides which links are
   worth showing.

   1. NALUNO KNOWLEDGE — a short, member-facing guide to every part of
      Naluno: what it is, how to do it, the rules that matter. Written the
      way a helpful person at Naluno would explain it. It never describes
      how Naluno is built (no code, no services, no internals).
   2. MATCHING — picks the one to three parts of the guide a question is
      about, so the model answers from facts instead of guessing.
   3. LINK JUDGEMENT — every web link found for a question is scored
      against the question before it can be shown. A link is only offered
      when it is clearly about what was asked.
   4. ACTIONS — an answer about a part of Naluno ends with a button that
      opens that part of the app.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NalunoCompassBrain = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const SITE = 'https://getnaluno.com';

  /* ---------------- 1. what Compass knows about Naluno ---------------- */
  const KB = [
    { id: 'naluno', title: 'What Naluno is', open: 'frequencies',
      keys: ['naluno', 'what is naluno', 'about naluno', 'who made naluno', 'what can naluno do', 'app', 'features', 'how does naluno work'],
      body: 'Naluno is a place to stay close to the people you choose. Six tabs along the bottom: Frequencies (your people), Wireline (private messages and calls), Band (live group rooms), Broadcast (videos, live and writing that last), Compass (me) and Callsign (you). No phone number is needed, only a handle. It was built so people can keep reaching each other even when the internet is restricted.' },
    { id: 'callsign', title: 'Your Callsign (account and profile)', open: 'callsign',
      keys: ['callsign', 'account', 'profile', 'handle', 'username', 'display name', 'tagline', 'photo', 'profile picture', 'sign up', 'create account', 'sign in', 'log in', 'login', 'password', 'forgot password', 'recovery email', 'edit profile', 'change name', 'settings', 'sign out', 'log out'],
      body: 'Your Callsign is your name on Naluno: a handle, not a phone number. To sign up choose Create account, pick a handle (at least 3 characters: a–z, 0–9 and _) and a password (at least 6). You can also Sign in with Google or use an email. Add a Recovery email so you can reset a forgotten password (Forgot password? on the sign-in screen). To change your photo, display name, tagline, handle or recovery email: Callsign tab → Edit callsign → Save callsign. Settings are on the Callsign tab: turn the dial and tap Open (Greenroom, Find Naluno, Call notification, Ringtone, My Contribution, Close Callsign). Sign out is at the bottom.' },
    { id: 'close', title: 'Closing your Callsign', open: 'callsign',
      keys: ['delete account', 'close account', 'remove account', 'deactivate', 'close callsign', 'delete my data', 'leave naluno'],
      body: 'To close your account: Callsign tab → Close Callsign → pick a reason → type your handle → Close it. This removes your Broadcasts and Signals and your login. You can also ask me to close it, or Write to Naluno if you want help first.' },
    { id: 'frequencies', title: 'Frequencies (your people)', open: 'frequencies', action: 'connect',
      keys: ['frequencies', 'friends', 'contacts', 'connect', 'add friend', 'add someone', 'find someone', 'find people', 'follow', 'connection', 'signal strength', 'strong signal', 'fading', 'off the grid', 'search people', 'people'],
      body: 'Frequencies are the people you have chosen to connect with; only connected people can message or call you. To add someone: Frequencies → Connect (Find people) → type their handle → Search → Connect. It shows on both sides at once. You can also connect in person with Spark. Signal strength shows how recently someone was active: Strong signal, Fading, Off the grid. Tap a person to open your chat, or the camera or phone icon to call.' },
    { id: 'signals', title: 'Signals (posts that fade after 24 hours)', open: 'broadcast', action: 'signal',
      keys: ['signal', 'signals', 'story', 'stories', 'status', 'new signal', 'post a signal', '24 hours', 'who viewed', 'seen by', 'fade'],
      body: 'A Signal is a short photo, video or text post that lasts 24 hours, seen by your connections. Broadcast tab → + New Signal → Photo, Video or Text → add a caption if you like → Post Signal. Videos over 60 seconds can be trimmed or split into 60-second parts. On your own Signal, Seen by shows who watched and how they reacted. You can delete a Signal any time.' },
    { id: 'wireline', title: 'Wireline (private messages)', open: 'wireline',
      keys: ['wireline', 'message', 'messages', 'chat', 'dm', 'text someone', 'send message', 'voice note', 'voice message', 'backup', 'chat backup', 'chat history', 'clear chat', 'delete message', 'translate chat', 'encrypted', 'end to end'],
      body: 'Wireline is your one-to-one chat, end-to-end encrypted and kept on your phone; Naluno cannot read it. Open someone from Frequencies and type in Send a signal…. Hold the mic for a voice note (up to 2 minutes), let go to send. Press and hold a message to react or delete. Translate this chat shows their messages in your language. Backups: Wireline menu (⋯) → Chat backup → Save a copy now (text only, saved to your phone). A new phone starts empty unless you open a backup. Offline messages wait and send when you are back online.' },
    { id: 'calls', title: 'Voice and video calls', open: 'frequencies',
      keys: ['call', 'calls', 'video call', 'voice call', 'phone call', 'ring', 'ringtone', 'missed call', 'greenroom', 'filter', 'filters', 'camera', 'call notification', 'calls not ringing', 'not receiving calls'],
      body: 'Call a connection with the phone icon (voice) or camera icon (video) on their row in Frequencies, or at the top of your Wireline chat. A video call opens the Greenroom first (Camera, Mic, Flip, Live background) → Start call. If nobody answers you can leave a voice signal, send a message or keep ringing. Filters: Callsign → Greenroom. To get calls while Naluno is closed: Callsign → Call notification → Enable call notifications; on Android the Naluno app is the most reliable. Naluno does not store the sound or picture of calls.' },
    { id: 'band', title: 'Band (live group rooms)', open: 'band',
      keys: ['band', 'bands', 'group', 'group chat', 'room', 'rooms', 'tune in', 'vibe', 'new band', 'start band', 'invite', 'ring the band', 'band live', 'group call'],
      body: 'A Band is a small live room with your connections; nobody owns it. On the Band tab start a New Band: Name, Vibe (the room scene), Who can tune in → Start Band. Tap Tune in to join. Inside you can type, send voice notes, record audio or video, or go LIVE while people are there. Invite or Copy link brings someone in; Ring rings the Band while it is live. Messages clear 2 hours after the last person leaves and cannot be recovered.' },
    { id: 'broadcast', title: 'Broadcast (video and writing that lasts)', open: 'broadcast', action: 'video',
      keys: ['broadcast', 'broadcasts', 'upload', 'upload video', 'post video', 'publish', 'video', 'chapters', 'for you', 'my broadcasts', 'feed', 'search broadcasts', 'private broadcast', 'schedule', 'publish later', 'strand', 'strands', 'offline watch', 'save for offline', 'delete broadcast', 'edit broadcast'],
      body: 'Broadcasts stay until you delete them and can be searched and shared. Broadcast tab → Video → Choose a video → title and topics → Publish Broadcast (up to 3 hours; long videos can be split into up to 24 chapters). Options: Private (only you), Publish later (scheduled), Strand (group related Broadcasts). For You, My Broadcasts, Toga and Search are along the top. Save a Broadcast for Offline watch from its ⋯ menu. New posts may wait for a first look before going out.' },
    { id: 'live', title: 'Going live', open: 'broadcast', action: 'golive',
      keys: ['go live', 'live', 'livestream', 'live stream', 'stream', 'watch live', 'join live', 'streaming'],
      body: 'Broadcast tab → Go live → give it a title → start. Your connections get a notification, and your live shows on the Broadcast feed with the live picture; anyone who taps it joins straight in. When you stop, the live can be saved as a chapter.' },
    { id: 'write', title: 'Writing (articles, stories, poems)', open: 'broadcast', action: 'write',
      keys: ['write', 'writing', 'article', 'story', 'poem', 'blog', 'essay', 'publish writing', 'listen', 'read aloud', 'link in writing', 'add link'],
      body: 'Broadcast tab → Write → title and your text → optionally add a photo (tick that it is yours, licensed or a cover) and write in chapters → Publish writing. Links you add (the Link button, or paste one) become tappable for readers. Readers can tap Listen to hear it read aloud. A photo is checked before the piece goes out.' },
    { id: 'room', title: 'Inside a Broadcast room', open: 'broadcast',
      keys: ['comment', 'comments', 'conversation', 'questions', 'answer', 'best answer', 'resources', 'updates', 'journey', 'results', 'keep a line', 'enter room', 'reply', 'react', 'like', 'dislike', 'nearby broadcasts', 'monetisation'],
      body: 'Each Broadcast has its own room. Vote 👍 or 👎, save a sentence privately with Keep a line, and Join the creator\'s Circle. Enter Room shows the views, Support creator, the Strand, and Monetisation. Monetisation opens the notes on who Naluno can pay. It is not Creator Support, and opening it does not pay anyone. Room tabs: Conversation (text, voice note or photo; links you paste are tappable), Questions (the creator can mark a best answer), Results, Resources (links and materials), Journey and Updates (creator only).' },
    { id: 'share', title: 'Sharing and passing on', open: 'broadcast',
      keys: ['share', 'share link', 'pass on', 'repost', 'send to friend', 'to signal', 'send in naluno'],
      body: 'In a Broadcast, open ⋯ → Pass it on: Share (a link), Pass on (reposts it with the original creator kept on it), Send in Naluno (to a connection) or To Signal.' },
    { id: 'toga', title: 'Toga (Wall of Fame)', open: 'broadcast',
      keys: ['toga', 'wall of fame', 'points', 'toga points', 'ranking', 'rank', 'leaderboard', 'top creators', 'views shared'],
      body: 'Toga is the ten people who moved Naluno most this month. Toga points: 1 for each view, 12 for each Circle join and 3 for each conversation message, this month. Broadcast → Toga; tap a name to see their work. Views shared switches your views between public (you can stand in Toga) and private.' },
    { id: 'views', title: 'How views are counted', open: 'broadcast',
      keys: ['views', 'view count', 'how are views counted', 'why views', 'views not increasing', 'view'],
      body: 'A view counts once per person per Broadcast, after they have actually watched it for a few seconds (the number of seconds is set by Naluno). Watching your own Broadcast does not count. Views update live.' },
    { id: 'circle', title: 'Circle (following a creator)', open: 'broadcast',
      keys: ['circle', 'join', 'follow creator', 'followers', 'subscribe', 'community'],
      body: 'Joining a creator\'s Circle keeps you with them for every Broadcast they publish. Open any of their Broadcasts → Join next to their name (Leave to leave). Circle joins count toward Toga.' },
    { id: 'support', title: 'Supporting a creator', open: 'broadcast',
      keys: ['support', 'tip', 'donate', 'pay creator', 'support creator', 'send money', 'gift', 'payment', 'pay', 'stripe', 'card', 'apple pay', 'google pay', 'refund'],
      body: 'In their Broadcast → Enter Room → Support creator → Support → pick or type an amount → Continue to pay. You pay on Stripe\'s secure page (card, Apple Pay or Google Pay) and come back to the Broadcast, which shows Paid once the payment is confirmed. Support is voluntary; paying again charges you again. For a payment problem, Write to Naluno.' },
    { id: 'payouts', title: 'Getting paid as a creator', open: 'broadcast',
      keys: ['get paid', 'payout', 'payouts', 'earn', 'earnings', 'make money', 'monetize', 'withdraw', 'bank', 'income', 'creator money'],
      body: 'In your own Broadcast, open Support → Get paid → Set up payouts with Stripe. Stripe asks for your name, phone number and where to send the money. Once payouts are on, Support sent to you goes to your Stripe account, which pays it out to your bank or card. Stripe payouts are not available in every country; its setup page will say if yours is not.' },
    { id: 'known', title: 'The Known mark', open: 'callsign',
      keys: ['known', 'verified', 'verification', 'badge', 'blue tick', 'check mark', 'get verified', 'known mark', 'ask to be known'],
      body: 'Known is a mark beside your name showing your name was reviewed. In a Broadcast → ⋯ → Ask to be Known → write who you are (12 to 500 characters) → Send. If accepted, tap Pay; the mark lasts a month at a time (Next month to extend). Naluno can also grant it. The mark shows wherever your name appears.' },
    { id: 'ads', title: 'Ads and promoting a Broadcast', open: 'broadcast',
      keys: ['ad', 'ads', 'advert', 'advertise', 'promote', 'promotion', 'boost', 'sponsor', 'skip ad'],
      body: 'Ads can play at breaks and can be skipped after a few seconds. To promote your own Broadcast: its ⋯ menu → Advertise → choose where it shows, how it is billed (per view, per tap or per completed view) and a prepaid amount → Save → Pay the prepaid amount. A person reviews the ad before it goes live.' },
    { id: 'compass', title: 'Compass (me)', open: 'compass',
      keys: ['compass', 'assistant', 'ai', 'what can you do', 'who are you', 'lock compass', 'compass password'],
      body: 'I am Compass, your private companion in Naluno. I can answer questions, help plan or think things through, tell you the weather where you are, say where your phone last pinged (with Find Naluno on), send a message to the Naluno team (Write to Naluno) or close your Callsign if you ask. The people who run Naluno cannot read this conversation. You can lock Compass with a password on this device. I can be wrong, and I am not emergency, legal or banking help.' },
    { id: 'find', title: 'Find Naluno (locate your phone)', open: 'callsign',
      keys: ['find my phone', 'lost phone', 'find naluno', 'locate', 'stolen phone', 'where is my phone', 'track phone'],
      body: 'On the phone you want to be able to find: Callsign → Find Naluno → switch on Report this phone and allow location (do this before it is lost). From another device: sign in, open Compass and ask me, or tap the radar; Ping this phone now asks for a fresh location. A phone that is off shows its last ping. It works only for your own phones.' },
    { id: 'spark', title: 'Spark (meet in person, talk across languages)', open: 'frequencies', action: 'spark',
      keys: ['spark', 'qr', 'qr code', 'meet', 'in person', 'translate', 'translation', 'language', 'luganda', 'swahili', 'kiswahili', 'languages'],
      body: 'Spark connects two phones side by side. Frequencies → Spark → show your QR or 5-character code, or tap Join theirs and enter their code (codes last 3 minutes). You get a shared Spark page where you each talk or type in your own language and see it translated. Done when finished; Open last Spark page reopens it.' },
    { id: 'lifeline', title: 'Lifeline (messages during shutdowns)', open: 'wireline',
      keys: ['shutdown', 'internet shutdown', 'blocked', 'no internet', 'offline', 'lifeline', 'vpn', 'mesh', 'sms', 'censorship', 'internet cut'],
      body: 'If a Wireline message cannot go out because the internet is blocked or cut, Naluno keeps it and tries other routes: a relay when some internet is still reachable, nearby Naluno phones passing it along (Android app), and SMS for people abroad. Messages are sealed so only the recipient can open them, and they carry no names. Open each person once while online so Naluno can seal messages to them. A message that arrives by two routes shows once.' },
    { id: 'rules', title: 'What is allowed on Naluno', open: 'broadcast', url: SITE + '/terms',
      keys: ['rules', 'allowed', 'not allowed', 'community guidelines', 'nudity', 'explicit', 'porn', 'sexual', 'screen', 'blocked post', 'post removed', 'why was my post', 'held', 'hold', 'cannot go out', 'swimwear', 'bikini'],
      body: 'Not allowed in public posts: exposed genitals or anus, exposed female nipples, nudity, sexual acts (even when covered), terrorism or calls to violence, threats, child exploitation, hate, harassment, scams, impersonation, dangerous or illegal content and spam. Allowed: swimwear, lingerie, shirtless men, dancing and suggestive poses with nipples and genitals covered. Every picture is checked before it goes out; when unsure, a person decides, and a held post says so. You can appeal a hold. Private chats are not checked or read.' },
    { id: 'origin', title: 'OriginID (copies and copyright)', open: 'broadcast',
      keys: ['originid', 'origin', 'copyright', 'copy', 'copied', 'stolen content', 'licensed', 'cover song', 'match', 'music rights'],
      body: 'OriginID compares a new post\'s picture, motion and sound with what is already published. A close match is held; tick the box if the work is yours, licensed or a cover. A match is not proof of infringement. You keep the rights to what you create.' },
    { id: 'report', title: 'Reporting and appeals', open: 'broadcast',
      keys: ['report', 'report someone', 'abuse', 'harassment', 'block', 'appeal', 'unfair', 'safety', 'scam'],
      body: 'To report a Broadcast: ⋯ → Report → choose what is wrong → tell us what happened → Send report. A person reads every report; sexual content comes off the feed while it is checked. If something of yours is held, the Appeal a safety hold sheet opens: say why it should be allowed → Send appeal, and a person looks again.' },
    { id: 'install', title: 'Installing Naluno', open: 'frequencies',
      keys: ['install', 'download', 'android app', 'iphone', 'ios', 'home screen', 'apk', 'play store', 'app store', 'update', 'new version'],
      body: 'Tap Install on the Add Naluno to Home Screen banner. On iPhone: Share → Add to Home Screen. On Android Chrome: menu → Install app, or use Download for the Android app (best for calls when Naluno is closed). When a new version is ready, a banner offers Update.' },
    { id: 'privacy', title: 'Privacy', open: 'callsign', url: SITE + '/privacy',
      keys: ['privacy', 'private', 'data', 'personal data', 'who can see', 'tracking', 'location', 'sell my data', 'security', 'safe'],
      body: 'No phone number is needed and Naluno does not sell your personal information or read your address book. Wireline chats are encrypted and kept on your phone. Location is off unless you turn it on. Calls are not recorded. Compass is private. Signals last about a day, Band messages clear 2 hours after the room empties, and Broadcasts stay until you delete them. The full Privacy Policy is on the website.' },
    { id: 'contact', title: 'Contacting Naluno', open: 'compass', url: SITE + '/',
      keys: ['contact', 'help', 'support team', 'customer service', 'complaint', 'problem', 'bug', 'feedback', 'talk to naluno', 'email naluno', 'write to naluno'],
      body: 'Tell me "write to Naluno" followed by your message and I will send just that message to the Naluno team, or use the Write to Naluno form on getnaluno.com. A person reads it.' },
    { id: 'invest', title: 'Investing and partnerships', url: SITE + '/invest/',
      keys: ['invest', 'investor', 'investment', 'partner', 'partnership', 'founder', 'funding'],
      body: 'Investors and partners can read about Naluno and reach the founder on the Invest page of getnaluno.com (Talk to the founder).' },
  ];

  const ACTIONS = {
    frequencies: { label: 'Open Frequencies', tab: 'frequencies' },
    wireline: { label: 'Open Wireline', tab: 'wireline' },
    band: { label: 'Open Band', tab: 'band' },
    broadcast: { label: 'Open Broadcast', tab: 'broadcast' },
    compass: { label: 'Stay in Compass', tab: 'compass' },
    callsign: { label: 'Open Callsign', tab: 'callsign' },
    video: { label: 'Post a video', tab: 'broadcast', click: 'newBroadcastBtn' },
    golive: { label: 'Go live', tab: 'broadcast', click: 'broadcastGoLiveBtn' },
    write: { label: 'Start writing', tab: 'broadcast', click: 'broadcastWriteBtn' },
    signal: { label: 'New Signal', tab: 'broadcast', fn: 'openNewSignalComposer' },
    connect: { label: 'Find people', tab: 'frequencies', click: 'findPeopleBtn' },
    spark: { label: 'Open Spark', tab: 'frequencies', click: 'sparkOpenBtn' },
  };

  /* ---------------- 2. matching ---------------- */
  const STOP = new Set(('a an the and or but if then so of to in on at by for with from into onto up down out over under about above below '
    + 'is are was were be been being am do does did done doing have has had having i me my mine you your yours he him his she her hers it its '
    + 'we us our they them their this that these those there here what which who whom whose when where why how can could would should will shall may might must '
    + 'please tell show give get got let know need want like just really very much more most some any all each every no not yes ok okay hi hey hello thanks thank '
    + 'naluno app does anyone something anything everything way ways thing things one ones make made use using used find look looking go going see also again still').split(' '));
  function stem(w) {
    w = String(w || '').toLowerCase();
    if (w.length > 5 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (w.length > 5 && /ing$/.test(w)) return w.slice(0, -3);
    if (w.length > 4 && /ed$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    return w;
  }
  function words(text) {
    return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/https?:\/\/\S+/g, ' ').replace(/[^a-z0-9À-ɏЀ-ӿ؀-ۿ' ]+/g, ' ')
      .split(/\s+/).filter(Boolean);
  }
  function terms(text) {
    const out = [];
    words(text).forEach(function (w) {
      w = w.replace(/'s$/, '').replace(/'/g, '');
      if (w.length < 2 || STOP.has(w)) return;
      const s = stem(w);
      if (out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }
  function phraseIn(text, phrase) {
    const t = ' ' + words(text).join(' ') + ' ';
    return t.indexOf(' ' + words(phrase).join(' ') + ' ') >= 0;
  }
  function kbScore(entry, text) {
    const q = terms(text);
    if (!q.length && !/naluno/i.test(text)) return 0;
    let s = 0;
    entry.keys.forEach(function (k) {
      if (phraseIn(text, k)) { s += k.indexOf(' ') > 0 ? 3 : 2; return; }
      // "delete my account" still matches "delete account"
      const kt = terms(k);
      if (kt.length > 1 && kt.every(function (w) { return q.indexOf(w) >= 0; })) s += 2.5;
    });
    const hay = terms(entry.title + ' ' + entry.keys.join(' '));
    q.forEach(function (w) { if (hay.indexOf(w) >= 0) s += 0.6; });
    return s;
  }
  /* The parts of the guide this question is about (best first). */
  function kbMatch(text, previous) {
    /* The last question only counts for a short follow-up ("and how do I undo it?"). */
    const followUp = !!previous && /\b(it|that|this|them|there|one)\b/i.test(String(text || '')) && terms(text).length <= 3;
    const scored = KB.map(function (e) {
      let s = kbScore(e, text);
      if (followUp && s < 1) s = Math.max(s, 0.9 * kbScore(e, previous));
      return { e: e, s: s };
    }).filter(function (x) { return x.s >= 2; }).sort(function (a, b) { return b.s - a.s; });
    if (!scored.length) return [];
    const top = scored[0].s;
    return scored.filter(function (x) { return x.s >= Math.max(2, top * 0.5); }).slice(0, 3).map(function (x) { return x.e; });
  }
  const HOWTO = /\b(how (do|can|to|does)|where (is|do|can)|can i|is there a way|what happens|why (is|does|can't|cant|won't|wont|did)|what is|what are|what's)\b/i;
  /* Is this question about Naluno itself (not the wider world)? */
  /* "Write a poem", "tell me a joke": a request for Compass to do
     something, not a question about Naluno. */
  const ASK_TO_DO = /^\s*(please\s+)?(write|compose|draft|create|make|give me|tell me a|explain|summari[sz]e|translate|list|plan|help me (write|plan|think|decide))\b/i;
  function aboutNaluno(text, matched) {
    const t = String(text || '');
    if (/\bnaluno\b/i.test(t)) return true;
    if (!matched || !matched.length) return false;
    if (/^\s*(thanks|thank you|thx|ok|okay|great|cool|nice|perfect|got it|awesome|lol|haha)\b/i.test(t)) return false;
    if (ASK_TO_DO.test(t) && !/\b(on|in|to) (naluno|broadcast|wireline|band|signal)/i.test(t)) return false;
    return HOWTO.test(t) || /\b(my|mine|i can't|i cannot|won't|wont|doesn't|isn't|not working|stuck)\b/i.test(t) || terms(t).length <= 2;
  }
  function kbNotes(entries) {
    return (entries || []).map(function (e) { return e.title + ': ' + e.body; }).join('\n');
  }
  function kbAnswer(entries) {
    const e = entries && entries[0];
    if (!e) return '';
    let out = e.body;
    if (e.url) out += '\n\n[' + e.title + '](' + e.url + ')';
    return out;
  }
  /* One button, for the part of Naluno the answer is mainly about. General
     answers (what Naluno is, installing it, the rules) get none. */
  const NO_CHIP = { naluno: 1, install: 1, privacy: 1, rules: 1, contact: 1, invest: 1, report: 1, compass: 1 };
  function actionFor(entries) {
    const e = (entries || [])[0];
    if (!e || NO_CHIP[e.id]) return '';
    const key = e.action || e.open;
    return key && Object.prototype.hasOwnProperty.call(ACTIONS, key) ? key : '';
  }

  /* ---------------- 3. link judgement ---------------- */
  const WEAK_HOSTS = /(^|\.)(pinterest\.|facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com|linkedin\.com|quora\.com)/i;
  const BAD_HOSTS = /(porn|xxx|xvideo|xnxx|xhamster|redtube|youporn|onlyfans|fansly|chaturbate|stripchat|camsoda|nsfw|hentai|bet365|1xbet|casino)/i;
  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
  }
  /* The words in a question that carry its meaning: names (Capitalised),
     numbers, and uncommon words. */
  function keyTerms(question) {
    const all = terms(question);
    const caps = [];
    String(question || '').replace(/\b([A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+)*)/g, function (m, g) {
      terms(g).forEach(function (t) { if (caps.indexOf(t) < 0) caps.push(t); });
      return m;
    });
    return { all: all, names: caps };
  }
  /* 0..1: how clearly a found page is about what was asked. */
  function relevance(question, hit) {
    if (!hit || !hit.url || !/^https:\/\//.test(hit.url)) return 0;
    const host = hostOf(hit.url);
    if (!host || BAD_HOSTS.test(host) || BAD_HOSTS.test(hit.title || '')) return 0;
    const k = keyTerms(question);
    if (!k.all.length) return 0;
    const titleT = terms(hit.title || '');
    const bodyT = terms((hit.snippet || '') + ' ' + host.replace(/\./g, ' ') + ' ' + decodeURIComponent(String(hit.url).split(/[?#]/)[0].split('/').slice(3).join(' ')).replace(/[-_]/g, ' '));
    let hitAll = 0, inTitle = 0;
    k.all.forEach(function (w) {
      const t = titleT.indexOf(w) >= 0;
      if (t) inTitle++;
      if (t || bodyT.indexOf(w) >= 0) hitAll++;
    });
    let score = hitAll / k.all.length;
    score = 0.65 * score + 0.35 * (inTitle / k.all.length);
    // Every name in the question must be on the page, or it is about someone/something else.
    if (k.names.length) {
      const namesHit = k.names.filter(function (w) { return titleT.indexOf(w) >= 0 || bodyT.indexOf(w) >= 0; }).length;
      if (namesHit < k.names.length) score *= namesHit / (k.names.length + 1);
    }
    if (WEAK_HOSTS.test(host)) score *= 0.75;
    return Math.max(0, Math.min(1, score));
  }
  /* The few links worth showing, best first; nothing that is only loosely related. */
  function pickLinks(question, hits, max, minScore) {
    const seen = {};
    return (hits || []).map(function (h) { return { h: h, s: relevance(question, h) }; })
      .filter(function (x) { return x.s >= (minScore == null ? 0.5 : minScore); })
      .sort(function (a, b) { return b.s - a.s; })
      .filter(function (x) { const host = hostOf(x.h.url); if (seen[host]) return false; seen[host] = 1; return true; })
      .slice(0, max || 2)
      .map(function (x) { return { title: x.h.title || hostOf(x.h.url), url: x.h.url, snippet: x.h.snippet || '', score: Math.round(x.s * 100) / 100 }; });
  }
  /* Does the person want a link? */
  function wantsLinks(text) {
    return /\b(link|links|url|website|site|page|source|sources|reference|article|read more|where can i (buy|get|read|watch|find|download)|buy|book|tickets?|download|official)\b/i.test(String(text || ''));
  }
  /* A tighter web query: the meaning-carrying words, plus the subject of the
     previous question for follow-ups ("where can I buy it?"). */
  function namesIn(text) {
    const out = [];
    String(text || '').replace(/\b([A-Z][\w'’-]+(?:\s+(?:of|the|and|de|la|van|von|[A-Z][\w'’-]+))*)/g, function (m) {
      const cleaned = m.replace(/^(Who|What|Whats|Where|When|Why|How|Which|Is|Are|Was|Were|Can|Could|Do|Does|Did|Tell|Show|Give|Please|I|The|A|An)\b\s*/g, '')
        .replace(/\s+(of|the|and|de|la|van|von)$/i, '').trim();
      if (cleaned && /^[A-Z]/.test(cleaned) && out.indexOf(cleaned) < 0) out.push(cleaned);
      return m;
    });
    return out;
  }
  function searchQuery(text, previous) {
    const t = String(text || '');
    const own = terms(t);
    const pronoun = /\b(it|that|this|they|them|him|her|he|she|its|there|his|hers)\b/i.test(t) && own.length <= 3;
    const base = own.join(' ');
    if (pronoun && previous) {
      const names = namesIn(previous);
      const prev = names.length ? names.join(' ') : keyTerms(previous).all.slice(0, 4).join(' ');
      const add = prev.split(/\s+/).filter(function (w) { return own.indexOf(stem(w.toLowerCase())) < 0; }).join(' ');
      return (add + ' ' + base).trim().slice(0, 80);
    }
    return base.slice(0, 80) || t.slice(0, 80);
  }

  /* ---------------- 4. the brief the model works from ---------------- */
  function systemPrompt(o) {
    o = o || {};
    const lines = [
      'You are Compass, the companion inside Naluno. You are warm, direct and genuinely useful — like a knowledgeable friend.',
      'Answer the question actually asked, first, in plain language. Usually 2 to 5 sentences; use short numbered steps only for how-to answers. No filler, no disclaimers about being an AI.',
      'When the question is about Naluno, answer only from the Naluno guide notes you are given, using the exact button and tab names from them. If the notes do not cover it, say you are not sure and suggest "write to Naluno". Never invent a Naluno feature, price, date or rule.',
      'Never describe how Naluno is built: no code, programming languages, databases, servers, cloud providers, vendors or internal systems, even if asked. Say that is not something you can share.',
      'For anything else, answer from your own knowledge and the web notes. If notes include a link, you may mention it only if it truly helps with this question; never write any other URL.',
      'Words like it, that, they, him and her refer to what was just discussed.',
    ];
    if (o.name) lines.push('The person you are talking to is called ' + o.name + '. Use their name rarely.');
    if (o.today) lines.push('Today is ' + o.today + '.');
    return lines.join(' ');
  }
  /* Nothing about how Naluno is built leaves Compass. */
  /* Nothing about how Naluno is built leaves Compass. A sentence that
     names the machinery is dropped, not rewritten, so the answer still
     reads naturally. */
  const INTERNALS = /\b(firebase|firestore|cloudflare|workers?\.dev|wrangler|onnx(runtime)?|nudenet|webrtc|turn servers?|stun servers?|indexeddb|localstorage|service workers?|github( pages)?|node\.?js|source code|api keys?|security rules|database schema|backend|tech stack)\b/i;
  function scrubInternals(text) {
    const src = String(text || '');
    if (!INTERNALS.test(src)) return src;
    const kept = [];
    let dropped = 0;
    src.split(/\n/).forEach(function (line) {
      if (!INTERNALS.test(line)) { kept.push(line); return; }
      const parts = line.match(/[^.!?]+[.!?]*\s*/g) || [line];
      const ok = parts.filter(function (p) { if (INTERNALS.test(p)) { dropped++; return false; } return true; }).join('').trim();
      if (ok) kept.push(ok);
    });
    let out = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (dropped && out.replace(/\[\[open:[a-z]+\]\]/g, '').trim().length < 12) {
      out = 'How Naluno is built is not something I share, but I am glad to help you use it. What would you like to do?';
    }
    return out;
  }


  return {
    KB: KB,
    ACTIONS: ACTIONS,
    terms: terms,
    kbMatch: kbMatch,
    aboutNaluno: aboutNaluno,
    kbNotes: kbNotes,
    kbAnswer: kbAnswer,
    actionFor: actionFor,
    relevance: relevance,
    pickLinks: pickLinks,
    wantsLinks: wantsLinks,
    searchQuery: searchQuery,
    systemPrompt: systemPrompt,
    scrubInternals: scrubInternals,
    hostOf: hostOf,
    BAD_HOSTS: BAD_HOSTS,
  };
});
