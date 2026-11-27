# Nearby

Live friend map with satellite view, usernames, friend requests, per friend privacy, driving detection, 5 day history, arrival alerts, Google sign in, bans, an owner panel and a GitHub release updater. It runs on Supabase (Auth, Postgres with row level security, Realtime). No Edge Functions or servers.

## Setup

1. Create a Supabase project.
2. Open SQL Editor and run `supabase/migrations/0001_init.sql` (or let the Deploy Supabase schema workflow push it, see step 6).
3. Google sign in: in Google Cloud create an OAuth client of type Web application. Add `https://<project-ref>.supabase.co/auth/v1/callback` as an authorized redirect URI. In Supabase go to Authentication, Providers, Google, paste the client ID and secret and enable it. No SHA-1 or google-services.json is needed any more.
4. Supabase, Authentication, URL Configuration: set Site URL to `https://yourname.github.io/<repo>/` and add these Redirect URLs: `https://yourname.github.io/<repo>/**` and `com.nearby.app://login-callback`. Turn off email sign ups (Providers, Email) so Google is the only way in.
5. Add the repo secrets listed below (update nearby-secrets/setup.sh to match).
6. Settings, Pages, Source: GitHub Actions. Push to main: Pages deploys, and the schema deploys whenever `supabase/` changes.
7. Push a tag such as v2.0.0 to build and publish the signed APK and update bundle.

Repo secrets: `SUPABASE_CONFIG` (JSON like `{"url":"https://<ref>.supabase.co","anonKey":"<anon public key>"}`), `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, plus the unchanged keystore secrets (`KEYSTORE_B64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`). The anon key is public by design; the row level security policies in the SQL protect the data. Never put the service role key in the app.

Android sign in opens Google in a Chrome tab and returns through the `com.nearby.app://login-callback` link, which the APK workflow adds to the manifest.

## Notifications on the free plan

There is no server, so alerts are made on each phone. While the app is running (it keeps a location service alive in the background) it notices when a friend arrives at or leaves one of your places, starts moving, sends a request or when the owner broadcasts, and shows a notification. If the app is fully closed or the phone kills it, no alerts arrive until it is opened. Real push when the app is closed needs a server (Cloud Functions on the Blaze plan).

## Free plan limits

Supabase has no per request read or write cap, but the free plan limits database size (500 MB), monthly active users, Realtime messages and concurrent Realtime connections, and pauses projects that are inactive for a week. The app writes your location when you move 20 m (at most every 10 seconds) or every 3 minutes, and each app reloads its lists once a minute as a safety net, so it suits a small group of friends.

## Owner panel

Open the web version and sign in as ytvas68@gmail.com. A row appears in You, then Owner panel. It lists registered accounts, bans (custom time or permanent) and sends broadcasts. Bans are enforced by the row level security policies and the app. The owner email is written in supabase/migrations/0001_init.sql, src/main.js and src/owner.js. To delete an account use Authentication, Users in the Supabase dashboard: everything that belongs to it is deleted too.

## Updates

Every release (tag vX.Y.Z) publishes nearby.apk, a small bundle zip and a note with the minimum APK version. When the app opens it checks the latest release. If a newer one exists the app is locked until it updates. Normal updates download only the bundle zip. If a release changes plugins or Android settings (v2.0.0 does: sign in moved to Supabase), raise minApk in package.json: the app then downloads the APK into its private cache, opens the installer and deletes it afterwards. The web version is never locked.

## Android background location

The app runs a foreground service with a notification while sharing. Choose Allow all the time for location and turn off battery optimization for Nearby.

## History

Points are saved when you move about 50 m or every 10 minutes, and each app deletes its own points older than 5 days. Friends only see it if you turn on Share my 5 day history.

## Local

npm install, npm run build, then serve www.
