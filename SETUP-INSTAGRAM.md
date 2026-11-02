# Instagram publishing & insights setup

Publishing is **optional and off by default**. The default workflow is to post manually from `out/<id>/` (so you can add trending audio in the app) and record it with `npm run mark-posted`. You still want the API for **insights** (`npm run sync`), which is what feeds the learning loop. Without it, use `npm run import:csv`.

This guide follows Meta's current *Instagram Platform* docs (Graph API **v26.0** at the time of writing). Meta renames buttons often. If a label differs, look for the closest equivalent and check the linked docs.

- Content publishing: https://developers.facebook.com/docs/instagram-platform/content-publishing/
- Media insights: https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights
- Instagram API with Instagram Login: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login

Only the official API is used. There's no scraping and no unofficial endpoints.

---

## 1. Make the account professional

In the Instagram app: **Settings → Account type and tools → Switch to professional account**. Choose **Creator** (or Business). The API only works for professional accounts.

## 2. Create a Meta app

1. Go to https://developers.facebook.com/apps and create an app (type **Business**).
2. Add the **Instagram** product and choose **API setup with Instagram login**. This is the simplest path and needs no Facebook Page.
3. Under **Roles**, make sure your own Instagram account has a role on the app (or add it as an Instagram tester and accept the invite in the app). While the app is in **Development mode**, it works for accounts with a role, which is all you need to publish to your own account. App Review is only needed if other people's accounts will use the app.

## 3. Permissions (scopes)

Request these for the token:

| Scope | Used for |
|---|---|
| `instagram_business_basic` | profile, media list, token refresh |
| `instagram_business_content_publish` | `npm run publish` / `npm run schedule` |
| `instagram_business_manage_insights` | `npm run sync` (views, reach, shares, saves, watch time) |

> Meta's overview page omits `instagram_business_manage_insights` from one list, but the insights reference requires it. If the dashboard doesn't offer it, insights calls will fail with a permissions error. Check the scope list in your app's dashboard.

## 4. Get a long-lived access token

**Easiest:** in the app dashboard under **Instagram → API setup with Instagram login → Generate access tokens**, add your account and copy the token. Dashboard tokens are long-lived (60 days).

**Manual OAuth flow** (if you prefer):

1. Open in a browser (replace the values):
   `https://www.instagram.com/oauth/authorize?client_id=APP_ID&redirect_uri=REDIRECT_URI&response_type=code&scope=instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights`
2. Approve. You're redirected to `REDIRECT_URI?code=...`. The code is single-use and valid for 1 hour.
3. Exchange the code for a short-lived token (1 hour):
   ```bash
   curl -X POST https://api.instagram.com/oauth/access_token \
     -F client_id=APP_ID -F client_secret=APP_SECRET \
     -F grant_type=authorization_code -F redirect_uri=REDIRECT_URI -F code=CODE
   ```
4. Exchange it for a long-lived token (60 days). Do this server-side only, because it uses your app secret:
   ```bash
   curl "https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=APP_SECRET&access_token=SHORT_LIVED_TOKEN"
   ```

**Refresh before it expires.** The token must be at least 24 hours old and still valid:
```bash
curl "https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=LONG_LIVED_TOKEN"
```
A token that isn't refreshed within 60 days expires, and you start again at step 4. Put a reminder in your calendar, or run the refresh from the GitHub Action.

## 5. Find your Instagram user id

```bash
curl "https://graph.instagram.com/v26.0/me?fields=user_id,username&access_token=LONG_LIVED_TOKEN"
```
Use `user_id` as `IG_USER_ID`.

## 6. Fill in `.env`

```dotenv
IG_USER_ID=1784...
IG_ACCESS_TOKEN=IGAA...
IG_API_HOST=graph.instagram.com
IG_GRAPH_VERSION=v26.0
```

Now `npm run sync` works, even with publishing still disabled.

## 7. Video hosting (publishing only)

Instagram downloads the video from a **public HTTPS URL** (`video_url`). Pick one option with `VIDEO_HOST`:

| `VIDEO_HOST` | How | Notes |
|---|---|---|
| `r2` (default) | Uploads `reel.mp4` + `cover.jpg` to a Cloudflare R2 bucket (S3 API, SigV4) | Free egress, cheap storage. Recommended. |
| `s3` | Same code against AWS S3 or any S3-compatible store (MinIO, Backblaze B2, Wasabi) | Set `S3_ENDPOINT` for non-AWS stores |
| `static` | You mirror `out/` to any static web host yourself (rsync, `wrangler pages deploy`, …) | The publisher uses `PUBLIC_BASE_URL/<id>/reel.mp4` and `…/cover.jpg` |
| `resumable` | No hosting: uploads the file straight to `rupload.facebook.com` | **Only for apps using Facebook Login for Business** (`IG_API_HOST=graph.facebook.com`) |

**Cloudflare R2 setup:**

1. Cloudflare dashboard → **R2** → create a bucket (e.g. `reels`).
2. Bucket → **Settings → Public access**: enable the `r2.dev` subdomain (or connect a custom domain). Copy the public URL, e.g. `https://pub-xxxx.r2.dev`.
3. **R2 → Manage API tokens → Create API token** with *Object Read & Write* for that bucket. Copy the Access Key ID and Secret.
4. `.env`:
   ```dotenv
   VIDEO_HOST=r2
   R2_ACCOUNT_ID=<your Cloudflare account id>
   S3_BUCKET=reels
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   S3_REGION=auto
   PUBLIC_BASE_URL=https://pub-xxxx.r2.dev
   ```
Files are uploaded under `reels/<id>-<timestamp>.mp4`. After Instagram has fetched them (once the post is live) you can delete them with an R2 lifecycle rule, e.g. "delete objects older than 7 days".

## 8. Turn publishing on

```dotenv
PUBLISHING_ENABLED=true
```

Test without posting:
```bash
npm run publish -- <id> --dry-run
```
Publish for real:
```bash
npm run publish -- <id>
```
What happens, per the docs: `POST /{ig-user-id}/media` with `media_type=REELS`, `video_url`, `caption`, `cover_url`, `share_to_feed` creates a container. The publisher then polls `GET /{container-id}?fields=status_code` until `FINISHED` (`ERROR`/`EXPIRED` abort; containers expire after 24h). Finally `POST /{ig-user-id}/media_publish` with `creation_id` publishes it, and the reel is recorded as posted with its media id and permalink.

Automatic posting at the configured slots:
```bash
npm run schedule   # plans the queue and publishes anything due (run it from cron or the GitHub Action)
```

## Limits & gotchas

- **Publishing quota:** about 50 API-published posts per rolling 24h (some Meta pages say 100). The publisher checks `GET /{ig-user-id}/content_publishing_limit` first.
- **Video spec:** MP4/MOV with the moov atom first, H.264/HEVC, 4:2:0, closed GOP, 23–60 fps, AAC ≤ 48 kHz, 3s–15min, ≤ 300 MB. The renderer outputs exactly this: 1080×1920, 30 fps, H.264 High, silent AAC 48 kHz, faststart, no edit lists.
- **Audio:** API-published reels can't attach trending audio. That's why manual posting is the default.
- **Insights** are delayed up to ~48h and some metrics are flagged "in development" by Meta (`views`, `total_interactions`, `ig_reels_video_view_total_time`). If the API rejects a newer metric for a media object, sync falls back to a core set (`reach, likes, comments, shares, saved, ig_reels_avg_watch_time`). `impressions` and `plays` are not used (deprecated for new media).
- `media_type` of a published reel reads back as `VIDEO`. Check `media_product_type` (`REELS`) instead.
