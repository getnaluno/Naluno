# CAMERA LOCK

**Owner's rule (8 October 2026):** a video call's camera starts at the right size, with no zoom, and stays that way. Nobody should need to flip to fix it. Caller and callee each see the other full screen, WhatsApp style, with their own picture in the small box.

No new work may change the call camera's size or shape without the owner's explicit go-ahead.

## How it is enforced

`js/camera-lock.test.cjs` fingerprints every piece of code that decides the call camera's dimensions:

- **What is asked of the camera:** the upright 3:4 full sensor, with no extra crop (`nalunoCameraPortrait`, `nalunoTouchDevice`, `nalunoIsPortraitDevice`, `nalunoCameraBox`, `nalunoHdVideo`, `nalunoLensConstraint`, `nalunoRaiseToHd`, `nalunoUnzoom`).
- **How a lens is opened and settled:** one path, the flip's path, for both the first open and every flip (`flipCamera`, `nalunoSwitchLens`, `nalunoLensAttempts`, `nalunoSettleCallCamera`, `nalunoWatchLensShape`, `enableCameraForCall`, `resolveCameraDeviceId` and `nalunoLensDeviceId`).
- **How your own picture is drawn and sent** (`drawVideoFit`, `nalunoCompositeFit`, `compositeFrame`, `drawSendCanvas`, `nalunoFitLocalPip`, `ensureCanvasSize`).
- **The callee's camera when answering** (`ensureCallMediaReady` in calls.js).
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

## The callee (fixed in 08c)

The callee's camera usually opens while Naluno is still in the background, woken by the ring. A hidden page gets no camera frames, so the shape check gave up before anyone looked. Answering then went straight on with that camera, without checking it, so the callee stayed zoomed in.

Now the check waits until Naluno is on screen. Answering settles and checks the callee's camera exactly as the caller's is checked. A lost camera is reopened the flip's way (upright 3:4), never at 720x1280.

## The real root cause, and the uniform rule (09a)

Phone browsers (Chrome on Android, and Safari on iPhone too) read a camera size request in the sensor's own terms, which are landscape, and turn the picture upright afterwards ([Chromium issue](https://issues.chromium.org/issues/40519078)).

Naluno asked upright phones for "1440 wide, 1920 tall". To the sensor, that is a tall slice of itself. Each phone produced that slice with whichever of its own picture modes came closest: a 16:9 mode or a square mode turned upright, or a cut-down 4:3. All of these are zoomed in. Which one happened depended on the modes that particular phone has, which is why some phones were zoomed and others were not. Naluno's "upgrade to HD" and "make it upright" steps then cut it down again.

The rule now, the same on every phone:

1. **Ask in the sensor's terms.** 4:3, and only from the phone's own modes, never a mode cut down from another. Every 4:3 mode of a camera holds the whole sensor. Capped at 2048 so it never runs at the full photo size.
2. **Measure the sensor.** Read its size from the camera itself (`getCapabilities`), in the same terms the browser reads requests. On a phone, only a 4:3 report is believed: a 16:9 maximum is just the phone's 4K video mode. If the picture does not hold the whole sensor, ask for exactly that shape from the camera's own modes.
3. **Never crop.** Nothing cuts a picture into another shape. A phone is never sharpened by cutting a bigger mode down.
4. **Phones without a 4:3 mode.** A camera that refuses 4:3 is remembered, and its own 16:9 mode is taken whole.
5. **Phones only.** Touch laptops and Chromebooks keep the computer rules, because their webcams are 16:9. An iPad counts as a phone.

`js/camera-lock.test.cjs` proves this on a catalogue of phone cameras, using the browsers' own way of choosing a picture mode, including its tie-break. The phones have different modes, square modes, 16:9 sensors, mixed maximums, and a browser that reads requests upright. The first request, or the measured one, must show 100% of the sensor on every phone. The test also confirms that the old request zoomed.

## Approved changes

- 08 Oct 2026 (08b): lock created, owner's request.
- 08 Oct 2026 (08c): callee's camera made the same as the caller's, owner's request; the callee's answer path added to the lock.
- 09 Oct 2026 (09a): the uniform rule above, owner's request ("uniform and permanent across all devices").
