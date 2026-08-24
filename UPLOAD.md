# Naluno — 20260823d

Built on **naluno-latest-full-20260823c** (full merge). This ship only changes Broadcast space UI:

## Views
- **Card layout** for view counts (not plain text).
- **Everyone** on a Broadcast sees **this Broadcast’s** views only.
- **Creator only** also sees **All of yours** (total across every Broadcast they published).

## Video stage
- Restored **Fit / Fill** chip on the hero.
- Stage follows the **uploaded video’s aspect ratio**.
- **Fit** = full picture (`object-fit: contain`).
- **Fill** = crop to stage (`object-fit: cover`).
- Landscape + phone tilt still expands toward full screen.

## Cache
- `?v=20260823d`
- Service worker `naluno-shell-v79`

## Ship rule
Always start from the previous full latest zip. Never thin-base a fix.
