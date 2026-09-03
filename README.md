# STARs Talent Transfer Explorer (public frontend)

The static, public half of the redesign -- plain HTML/CSS/JS, safe to
publish because it contains none of the underlying skill or wage data.
Everything it displays comes from calls to the private Cloudflare Worker
API at request time.

## Before you publish

Open `config.js` (either locally, or right in GitHub's web editor after
uploading) and set `window.STARS_API_BASE_URL` to your deployed Worker's
URL. Without this, the page loads but shows "Could not reach the STARs
API."

## Publishing on GitHub Pages

1. Upload these 4 files (`index.html`, `app.js`, `config.js`,
   `styles.css`) to a **public** GitHub repo -- nothing sensitive is in
   them.
2. In that repo: Settings -> Pages -> Source: "Deploy from a branch" ->
   Branch `main`, folder `/ (root)`.
3. GitHub gives you a URL like `https://yourusername.github.io/reponame/`.
   That's the live tool -- free, permanent, and it never sleeps.

## Local preview (optional, needs Python)

```
python3 -m http.server 8080
```
Then open http://localhost:8080/.
