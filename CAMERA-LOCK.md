# CAMERA LOCK

**Owner's rule (8 October 2026):** a video call's camera starts at the right size, with no zoom, and stays that way. Nobody should need to flip to fix it. Caller and callee each see the other full screen, WhatsApp style, with their own picture in the small box.

No new work may change the call camera's size or shape without the owner's explicit go-ahead.

## How it is enforced

`js/camera-lock.test.cjs` fingerprints every piece of code that decides the call camera's dimensions:

- **What is asked of the camera:** the upright 3:4 full sensor, with no extra crop (`nalunoCameraPortrait`, `nalunoTouchDevice`, `nalunoIsPortraitDevice`, `nalunoCameraBox`, `nalunoHdVideo`, `nalunoLensConstraint`, `nalunoRaiseToHd`, `nalunoUnzoom`).
- **How a lens is opened and settled:** one path, the flip's path, for both the first open and every flip (`flipCamera`, `nalunoSwitchLens`, `nalunoLensAttempts`, `nalunoSettleCallCamera`, `nalunoWatchLensShape`, `enableCameraForCall`, `resolveCameraDeviceId` and `nalunoLensDeviceId`).
- **How your own picture is drawn and sent** (`drawVideoFit`, `nalunoCompositeFit`, `compositeFrame`, `drawSendCanvas`, `nalunoFitLocalPip`, `ensureCanvasSize`).
- **How the other person fills the screen** (`nalunoRemoteFit`, `nalunoFitRemoteVideo`).
- **Which picture is sent** (`nalunoOutboundPortrait`).
- **The CSS of the call screens' video boxes:** every rule whose selector names `#remoteVideo`, `remote-stage`, `local-pip`, `#localPip`, `pipStageCanvas`, `camStageCanvas`, `ringStageCanvas`, `pipRawVideo`, `incomingSelfVideo` or `data-cam`. A new rule anywhere in `app.css` that touches these is caught too, including rules inside `@media` blocks and selectors that span several lines.

If any of these change, the test fails with "CAMERA LOCK". Do not just update the fingerprints:

1. Undo the change, or ask the owner.
2. Only with the owner's go-ahead, run `CAMERA_LOCK_PRINT=1 node js/camera-lock.test.cjs`, put the new values in `APPROVED`, and add a line below saying who approved it and why.

## Why it started zoomed (fixed in 08b)

- The camera's shape was chosen from the phone's orientation report. For a moment, that report could say "landscape" (for example, an app opened from landscape, or some phone browsers).
- The camera was then asked for 16:9. The phone gave its cropped 16:9 mode turned upright, which is 9:16: a zoomed-in face.
- A flip asked again later, when the report said "portrait", and got the full 3:4.

Now, on a phone, the camera is asked for upright 3:4 if either the window or the orientation report says upright. Only when both say sideways is the phone treated as held sideways. Computers keep the old test. The first open also uses exactly the flip's lens path. A warm camera opened any other way is reopened that way before a call. Once the camera has real frames, its shape is checked: if it is still 9:16 (or a landscape strip from the front camera), it is asked again, then reopened once the flip's way, automatically. A reopen never outlives the call. A muted mic stays muted. A camera that only has the 9:16 mode is not reopened again and again.

## Approved changes

- 08 Oct 2026 (08b): lock created, owner's request.
