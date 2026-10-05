# ProvenanceOS UX V2 — Australian Provenance Project

Restrained dark/glass UI for registering opal specimens, photographing them, and attaching pXRF (Vanta) readings.
Data is stored in Supabase: samples and readings in Postgres, photos in a private Storage bucket.

No build step. Plain HTML/CSS/JS plus `@supabase/supabase-js` from a pinned, integrity-checked CDN link.

## First-time setup (about five minutes)

1. **Create your login.** Supabase dashboard → *Authentication → Users → Add user*. Enter an email and password and tick **Auto Confirm User**.
2. **Create the tables.** *SQL Editor → New query*, paste all of [`supabase/schema.sql`](supabase/schema.sql), press **Run**. It's safe to run again.
3. **Close the front door.** *Authentication → Sign In / Providers → turn off "Allow new users to sign up".* (Even if left on, strangers can't read or write anything — only people on the `staff` list can — but there's no reason to let them create accounts.)

Then run the app and sign in:

    python3 -m http.server 8787

Open http://127.0.0.1:8787. Until step 2 is done the app shows a "Database not set up yet" screen instead of the sign-in form.

## Adding a colleague

Create them under *Authentication → Users*, then run this once in the SQL editor:

    insert into public.staff (user_id) select id from auth.users where email = 'them@example.com';

(Re-running the last statement of `schema.sql` authorises everyone currently listed under Users.)

## What is stored

| Table / bucket | Holds |
| --- | --- |
| `samples` | One row per specimen. IDs `AND-000001…` are assigned by the database, so two phones can't collide. |
| `sample_images` + bucket `sample-images` | Original photo, a small thumbnail, and the original's SHA-256. The bucket is private; the app uses short-lived signed links. |
| `analyses` | One row per Vanta reading: parsed element values (`results`) and the untouched CSV row (`raw`). |
| `sample_events` | History ("Registered", "Photo added", "pXRF attached"), written by database triggers — the browser can't write it. |
| `staff` | Who is allowed in. |

It is deliberately **append-only**: the app can add and read, but not edit or delete. Mistakes are corrected by adding, not rewriting. Say if you want an edit/void workflow.

Sample IDs are unique and ascending but **not gap-free** — a failed save can use up a number (normal for database sequences).

## Importing Vanta data

*Samples → (a sample) → Attach pXRF* attaches a CSV to that sample. *Analysis → Import Vanta CSV* does a bulk import and matches each reading to a sample by an ID written in its row (e.g. `AND-000012` in the Sample / Notes column).

- Re-importing the same file, or an export that overlaps an earlier one, never duplicates readings.
- `<LOD`, `ND` etc. are stored as "below detection" (value empty, flag set) — never silently turned into 0.
- Units come from the file when it has them; otherwise values are stored as **ppm** and the import screen says so.
- Dates are read day/month/year unless the numbers force otherwise.
- The parser ([`vanta.js`](vanta.js)) is tolerant of the header styles Vanta/Olympus exports use, but it was written without a real export to hand. **If an import looks wrong, send me the CSV** and I'll tune it and add it to the tests.

## Tests

    node --test tests/vanta.test.js     # CSV parser

## Deploying

Any static host works (Netlify, Vercel, Cloudflare Pages, GitHub Pages). It must be served over **https** — the phone camera and secure hashing don't work on plain http (localhost is fine).

`config.js` holds the project URL and the **publishable** key, which is designed to be public. Never put a `sb_secret_…` / `service_role` key in this project.

## Not built yet

- **Offline queue.** Registering needs a connection. If the field has no signal the form keeps what you typed and shows an error, but doesn't save for later.
- Samples created in the old localStorage prototype were not migrated (they only had demo data and no photos).
- Search/filter on the Samples list (it loads the latest 500).
