const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

/* Fires whenever a new document is created in the top-level `calls` collection —
   i.e. the exact moment someone starts a real outgoing call (see startRealCall() in
   index.html). Looks up the callee's registered device token and sends a real push,
   which is what lets a ringtone-equivalent reach them even with the app fully closed.
   Requires the Blaze (pay-as-you-go) plan — Cloud Functions don't run at all on the
   free Spark plan, regardless of whether you end up using any paid usage. */
exports.notifyIncomingCall = functions.firestore
  .document('calls/{callId}')
  .onCreate(async (snap, context) => {
    const call = snap.data();
    if (!call || call.status !== 'ringing') return null;

    const db = admin.firestore();
    const [calleeDoc, callerDoc] = await Promise.all([
      db.collection('users').doc(call.calleeUid).get(),
      db.collection('users').doc(call.callerUid).get(),
    ]);

    const token = calleeDoc.exists ? calleeDoc.data().fcmToken : null;
    if (!token) return null; // callee never enabled call notifications — nothing to send

    const callerName = (callerDoc.exists && callerDoc.data().name) || 'Someone';

    try {
      await admin.messaging().send({
        token,
        notification: {
          title: 'Incoming call',
          body: callerName + ' is calling you on Naluno',
        },
        webpush: {
          headers: { Urgency: 'high', TTL: '60' }, // deliver immediately, don't hold it
                                                     // for battery-saving batching — a
                                                     // call notification that arrives
                                                     // late after the ring has already
                                                     // ended isn't worth much
          fcmOptions: { link: '/' }, // opens/focuses the app when the notification is tapped
        },
      });
    } catch (e) {
      // A stale/expired token is the most common failure here — nothing to retry on;
      // the person will just re-register next time they open the app and it prompts again.
      console.error('notifyIncomingCall failed:', e.message);
    }
    return null;
  });
