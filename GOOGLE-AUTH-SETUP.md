# Native Google Sign-In (Android shell)

Web Google sign-in opens Chrome and gets stuck on `*.firebaseapp.com`.  
Native Google Sign-In stays inside the app and hands a token to Firebase.

## 1. Deploy the updated web app

Upload the new `index.html` + `firebase-config.js` to the site that the shell loads  
(currently `https://getnaluno.com`).

Or, if you use local `www`:

```bat
cd C:\naluno\android-shell
node scripts\copy-web.js
```

(after copying the new files into `C:\naluno\`)

## 2. Get your **Web** client ID

1. Open [Google Cloud Console](https://console.cloud.google.com/) → same project as Firebase (`naluno-28a00`)
2. **APIs & Services → Credentials**
3. Under **OAuth 2.0 Client IDs**, find the client of type **Web application**  
   (Firebase often creates one named “Web client (auto created by Google Service)”)
4. Copy the **Client ID**  
   (looks like `183354363901-xxxxxxxxxxxx.apps.googleusercontent.com`)

Paste it in **three** places (same value everywhere):

### A. `firebase-config.js` (on the website)

```js
const GOOGLE_WEB_CLIENT_ID = "PASTE_WEB_CLIENT_ID_HERE.apps.googleusercontent.com";
```

### B. `android-shell/capacitor.config.json`

```json
"GoogleAuth": {
  "scopes": ["profile", "email"],
  "serverClientId": "PASTE_WEB_CLIENT_ID_HERE.apps.googleusercontent.com",
  "forceCodeForRefreshToken": true
}
```

### C. Android `strings.xml`

File:

```text
C:\naluno\android-shell\android\app\src\main\res\values\strings.xml
```

Add inside `<resources>`:

```xml
<string name="server_client_id">PASTE_WEB_CLIENT_ID_HERE.apps.googleusercontent.com</string>
```

## 3. Add SHA-1 fingerprint (required or you get error 10)

In a terminal:

```bat
cd C:\naluno\android-shell\android
gradlew signingReport
```

(or `.\gradlew signingReport` in PowerShell)

In the output, under **Variant: debug**, copy **SHA-1**.

Then:

1. [Firebase Console](https://console.firebase.google.com/) → project **naluno-28a00**
2. Gear → **Project settings** → your **Android** app (`com.naluno.app`)
3. **Add fingerprint** → paste SHA-1 → Save

Wait a few minutes for Google to propagate.

## 4. Install the plugin and rebuild

```bat
cd C:\naluno\android-shell
npm install
npx cap sync android
npx cap open android
```

In Android Studio: **Run ▶**

## 5. Test

1. Open Naluno on the phone  
2. Tap **Sign in with Google**  
3. You should get the **account picker inside the app** (not Chrome stuck on firebaseapp.com)  
4. After choosing an account, you should land in the app signed in  

## Troubleshooting

| Symptom | Fix |
|--------|-----|
| Error 10 / DEVELOPER_ERROR | SHA-1 missing or wrong; Web client ID not set in all 3 places |
| Plugin not ready | `npm install` + `npx cap sync android` + full reinstall of app |
| Still opens Chrome | Shell is loading old web JS — redeploy `index.html` to getnaluno.com or copy-web + sync |
| Email works, Google doesn’t | Almost always SHA-1 or Web client ID |

## Note on server.url

`capacitor.config.json` is set to load `https://getnaluno.com` so you always get the latest web app after deploy.  
Local `www` is only needed if you switch `server.url` off.
