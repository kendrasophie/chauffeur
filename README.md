# Estela's Exam Coach

Personal study app (HTML + CSS + JS, no build step) to practise short B1 English answers for the chauffeur onboarding exam.

## Sections
- **Cards** – question, picture + key fact, tap *Show answer*, listen in English, mark *I know it* / *Again*. Swipe left/right to move.
- **Examiner** – hands-free oral practice: the voice asks, you answer out loud during the thinking time, then you hear the model answer.
- **Quiz** – multiple choice with explanations.
- **All** – searchable list of every question and answer.

## Edit content
All questions live in `data.js` (`CARDS` for study cards, `QUIZ` for multiple choice).

## Background music
Four concentration tracks are already included (`music/concentration-1..4.m4a`). To change them:

1. Upload your audio files into the `music/` folder.
2. List them in `music/tracks.js`, e.g.
   ```js
   window.MUSIC_TRACKS = ["music/hemisync-alpha.mp3", "music/hemisync-focus.mp3"];
   ```
3. Tap ♪ in the app. Music lowers automatically while the voice speaks.

## Publish on GitHub Pages
1. Create a repository and upload all files (keep the folder structure).
2. Settings → Pages → Source: *Deploy from a branch* → `main` / root → Save.
3. Open `https://<your-user>.github.io/<repo>/` on your phone and "Add to Home screen".

Voice uses the phone's built-in English voices (Settings ⚙ → choose voice and speed).
