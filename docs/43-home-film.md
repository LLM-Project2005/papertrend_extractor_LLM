# 43. The film on the home page

2026-10-29. The user asked for the Vox-style film, their favourite of the product films, on the home page. The film is the paper explainer: 79 s at 1920 × 1080, 60 MB, made in `~/lemo-opuscar/films/pt-papertrail`.

## Choice

A 60 MB file at about 6 Mbps would stall on a slow connection. Two ways were weighed:

- **Our own CDN:** four qualities as adaptive streaming on Firebase Hosting.
- **YouTube:** YouTube serves each viewer a quality to suit the connection.

The user chose YouTube, with the film in a new section under the hero.

- **Video:** https://youtu.be/FsquHUMrtTE ("Papertrend showcase"), on the Papertrend channel. It replaced the 41-paper cut, https://youtu.be/QbjW9ytJqKM, on 2026-10-31.
- **Upload:** the user uploaded it. The upload files are in `~/lemo-opuscar/films/pt-papertrail99`: `pt-papertrail99.mp4` and `pt-papertrail99.srt`.

### The 99-paper cut (2026-10-31)

The first cut told the story of a 41-paper sample. Once the EIL repository held all 99 retrievable papers, the film was rebuilt on them, with the same style, score and length (79 s):

- 2007–2025, 19 years.
- Up to 2018, English for a specific job was 6 of 48 papers; since then, 1 of 46. Scaffolding went from 0 to 5 and formative assessment from 1 to 5.
- The scaffolding question in chat: five of the six cited studies found students improved. One claim is traced back to its sentence in the paper.

The heading stays "See it in 79 seconds."; the lead now reads "Ninety-nine papers, nineteen years…". The poster is the new film's frame at 0:09 (the pile of papers with "99 papers" and the 2007 and 2025 stamps); at 1280 × 720 no page text can be read.

## How it is built

- **Section:** "See it in 79 seconds." sits between the hero and "Three parts, one repository" (`src/app/page.tsx`).
  - Its words and the video's id are in `homeFilm` (`marketing-content.ts`).
  - An empty id hides the section.
- **Nothing comes from YouTube until the reader presses play** (`FilmPlayer.tsx`):
  - Until then the page shows a poster from this site: `public/marketing/film/poster.webp`, the film's frame at 0:09 (0:07 in the first cut), 1280 × 720, 77 KB.
  - Pressing play swaps the poster for YouTube's privacy-enhanced player, `www.youtube-nocookie.com/embed/<id>?autoplay=1&rel=0&playsinline=1`. It starts at once, and at the end suggests only the channel's own videos.
- **Security policy:** frame-src adds `https://www.youtube-nocookie.com` and nothing else (`next.config.mjs`).
- **Privacy policy:** names YouTube as a processor once the film plays, and its cookies in "Cookies and browser storage". The date is now 29 October 2026.
- **Poster choice:** a frame from 0:10–0:15 was left out because it shows authors' email addresses from the papers' first pages.

## To change the film

1. Upload the new cut to the channel and put its id in `homeFilm.youtubeId`.
2. If the length changes, update `length` and the heading.
3. Make a new poster with `ffmpeg -ss <s> -i film.mp4 -frames:v 1 -vf scale=1280:720 -c:v libwebp -quality 70 poster.webp`.

## Checks

- **Tests:**
  - `site-ui-behaviour`: the page has one named play button, its poster is this site's with its box reserved, and there is no YouTube address or iframe before play.
  - `site-headers`: the frame-src.
  - `legal-providers`: YouTube is named in the privacy policy.
- **Local production build:** at 1440 px and 390 px, in light and dark, no YouTube request was made before play, and the player loaded after play with nothing blocked.
- **Pilot (00299-kx2) and production (00105-yac, release #304, 2026-10-29):** `scratchpad/pw/p73-film.cjs` was run in Chrome on both, with the same results. No YouTube request was made before play. Nine seconds after pressing play, the film was 7.5 s in, with nothing blocked. Both https://research-trend-analysis.web.app and https://papertrend.web.app serve the section.
- **Captions:** the player showed YouTube's automatic English captions. Uploading `pt-papertrail.srt` in YouTube Studio replaces them with the script's own wording.
