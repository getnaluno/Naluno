/* Canonical Privacy Policy, effective 20 October 2026.
   The website (privacy.html and privacy/index.html) and the app
   (onboard.js) show this same text. Change them in the same edit.
   js/fixes-1019a.test.cjs fails if they differ. */
window.NALUNO_PRIVACY_HTML = `  <p class="kicker legal-kicker">Effective 21 October 2026 · getnaluno.com</p>
  <p>This Privacy Policy explains what Naluno collects, why, who can see it, and how long it stays. It is written in ordinary language on purpose. If a sentence here does not match what the app actually does, the app is wrong — not this page — and we will correct the app.</p>
  <h3>1. Who we are</h3>
  <p>Naluno is the service at <strong>getnaluno.com</strong>. It is a place to be reachable without handing over a phone number. This policy applies to the website, the installable web app, and the Android shell of the same app.</p>
  <h3>2. What this app is not</h3>
  <p>Naluno does not ask for a phone number or a SIM card. It does not sell your personal information. Contribution points inside the app are not money and are not a payment. Creator Support is not live: nothing is charged today.</p>
  <h3>3. The account you create</h3>
  <p>To use Naluno you create a Callsign. That can be a handle and password (no email required), with an optional recovery email; Google sign-in; or an email and password. Sign-in is provided by Google Firebase Authentication. We store your user id, display name, handle, tagline, avatar, colour, and the settings you choose. We do not receive your Google password.</p>
  <h3>4. People you connect with</h3>
  <p>Frequencies are connections you make on purpose — search a handle, accept a request, or Spark in person. We store those connections so both of you can see each other, message, and call. We do not scrape your phone’s address book.</p>
  <h3>5. Messages</h3>
  <p><strong>Wireline</strong> (one-to-one) uses end-to-end encryption. The chat database lives on this phone (IndexedDB — the browser’s equivalent of SQLite). The server holds an encrypted drop only until the other phone copies it, then that drop is deleted. If the other person has no key yet, the words stay on this phone and are not written to the server in the clear. Naluno can still see that a conversation exists, who the two people are, and roughly when something last moved — not the words. A new phone starts empty unless a copy is opened from Chat backup on Wireline. Photos, voice and files that do not fit in the drop are stored as files the other phone can fetch. That store refuses HTML and scripts, and a browser is told not to run them. It is a holding tray, not a public page and not the archive. Band is unchanged: a room, wiped about 2 hours after it is empty.</p>
  <p><strong>Band</strong> is a shared room. While people are in the square, messages and clips are stored so everyone there can see them. When the last person leaves, the gathering is deleted after 2 hours. After that wipe, those messages are removed and are not readable.</p>
  <h3>6. Video and photos you publish</h3>
  <p><strong>Signal</strong> is a short clip meant to fade — about a day, then removed. <strong>Broadcast</strong> stays until you delete it. Live video is a real-time call between devices; Naluno does not keep a copy of the live picture as a file unless you publish a Broadcast. Media files are stored on Cloudflare R2 through Naluno’s own upload workers. Copyright in what you create stays with you.</p>
  <h3>7. Calls</h3>
  <p>A call uses WebRTC between the two phones. The picture and sound of the call are not stored by Naluno. Incoming-call alerts use Firebase Cloud Messaging if you allow notifications. Naluno keeps a record that a call or message happened — who reached whom, when, for how long, and whether it connected. It never contains what was said, shown or written. These records are kept for 12 months so Naluno can look into reports of abuse, fraud or threats and answer lawful requests, and are then deleted automatically. A record is kept longer only while an open report, investigation or legal request needs it, and is deleted once that is closed. Only a small number of people Naluno authorises can open these records, and every time they are opened it is logged.</p>
  <h3>8. Location</h3>
  <p>Location is off unless you turn Find Naluno on. <strong>Find Naluno</strong> stores this phone’s place on your own account, for your devices. Other members cannot read that place. The people who run Naluno can see a phone’s last reported place, to help with a lost phone or a safety matter; they cannot see Find Naluno history. A previous version also copied it onto the profile any signed-in member could open; that copy is removed when you next open Naluno, and it is not written again. Weather uses this phone’s place so the reading matches where you are. We do not build a location history for weather.</p>
  <h3>9. Compass</h3>
  <p>Compass is a private notebook plus an assistant. Messages you type there are stored on your account. You can lock Compass with a password on the device. The people who run Naluno cannot read that notebook. If you use <strong>Write to Naluno</strong> or <strong>Close my Callsign</strong>, that one request is sent to them — not the rest of the conversation. Compass answers are written by AI and can be wrong. If you report an answer (the small ⚑ beside it), that answer goes to the people who run Naluno with your report; your question does not.</p>
  <h3>10. Diagnostics</h3>
  <p>When something goes wrong on your phone (a call that does not connect, a refused save), the app sends Naluno a short technical note: what failed, the app version and the kind of phone — never message text, pictures, sound or addresses. The app also counts how it is used, so Naluno can improve it: how often things happen, how long they take in rough bands (for example 1–5 minutes), and how they turned out — for example whether a call connected, or how far into a video people watch. Counts never include words, pictures, sound, search text or where you are; the country they come from is the country of the network. You may choose your country when you join, or under Callsign; only the country is kept.</p>
  <h3>10a. The public website</h3>
  <p>The pages at getnaluno.com record how the site is used: that a visit happened, roughly how long it lasted, the country (from the network, not from GPS), city when the network provides it, the kind of device and browser, the referring site, the page path, and whether someone tapped Open Naluno. A random id lives in this browser so return visits can be counted. It is not a Callsign and is not joined to an account. The people who run Naluno read these counts. Messages you type in the contact form are mail, not this log.</p>
  <h3>11. Who we share with (processors)</h3>
  <p>Google Firebase (accounts, database, push), Google Cloud Monitoring (operator usage counts, not a public profile), Cloudflare (file storage and edge workers), Stripe (card checkout, when a payment is turned on), mobile-money collection beside Stripe (a phone cannot mark itself paid), Sunbird AI (Luganda speech, only when that voice is used; the phone does not talk to Sunbird directly), Open-Meteo (weather), a reverse-geocoder for place names, GeoJS (country of a website visit, from the network address), and a TURN/STUN provider so a call can connect. We do not sell lists of people.</p>
  <h3>11a. Requests from authorities</h3>
  <p>Naluno shares information about an account with police, courts or other authorities only when the law requires it, such as a valid court order, or when we believe in good faith that it is needed to prevent imminent harm to someone. We review each request, and we may refuse or challenge one that is not lawful or asks for too much. When we do share, we give only what the request asks for. Wireline messages are encrypted on the phones, so Naluno cannot read them or give their content to anyone.</p>
  <h3>12. How long we keep it</h3>
  <ul>
    <li>Account and Callsign — until you delete the account. Deleting it removes your Broadcasts, Signals, files and login at once, and everything else (profile, Compass notes, Find Naluno history, Frequencies, push addresses) 30 days later. An account Naluno closes for breaking the Terms is kept as the record of why, and so is an account kept for an open report, investigation or legal request.</li>
    <li>Wireline — on this phone after delivery. Encrypted drops on the server last until the other phone takes them, or about 7 days, whichever is first.</li>
    <li>Band — deleted 2 hours after the last person leaves. Not archived; it cannot be recovered by anyone, Naluno included.</li>
    <li>Signal media — about 25 hours.</li>
    <li>Broadcast — until you delete it.</li>
    <li>Call and message records — 12 months, and longer only while an open report, investigation or legal request needs them.</li>
    <li>Usage counts — the counts each phone sends are kept 180 days, then deleted. Daily totals, which cannot be traced to a person, are kept.</li>
    <li>Find Naluno pings — replaced by the next ping. Find Naluno history (where your own phones have been, while Find Naluno is on) — only you can see it; kept until you delete it with Delete history in Find Naluno.</li>
  </ul>
  <h3>13. Your choices</h3>
  <p>You can edit Callsign, remove a photo, turn Find Naluno off, hide the weather strip, lock Compass, refuse notifications, and sign out. You can stop someone reaching you (⋮ → Drop, and tick “Also stop them reaching me”), and report a person, a Broadcast, a Signal or a Compass answer; the person you report is not told who reported them. You can delete the account under Callsign → Delete account, or ask through the contact form on getnaluno.com (tick “This is a request to delete a Naluno account”). Compass and the contact form can also reach the people who run Naluno.</p>
  <h3>14. Children</h3>
  <p>Naluno is not for children under 13. If you are 13–17, use it only with a parent or guardian’s permission where your country requires that. Naluno does not allow any content that sexualises or exploits children; see our <a href="/child-safety/">Child safety standards</a>.</p>
  <h3>15. Security</h3>
  <p>We use HTTPS, Firebase rules, and encryption on Wireline. Protect your password. If you use Google sign-in, write down the recovery code for encrypted messages — we cannot reset that for you.</p>
  <h3>16. Outside your country</h3>
  <p>Firebase, Cloudflare, and the weather services may process data in the United States or other countries.</p>
  <h3>17. Changes</h3>
  <p>If this policy changes in a way that matters, we will update the date at the top and, when the change is large, show a notice in the app.</p>
  <h3>18. How to reach us</h3>
  <p>Use the contact form on getnaluno.com, or Compass after you sign in (Write to Naluno). You can also email <a href="mailto:naluno@getnaluno.com">naluno@getnaluno.com</a>. Say that your message is about privacy so it is treated as one.</p>
`;
