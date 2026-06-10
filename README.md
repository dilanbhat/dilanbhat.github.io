# dilanbhat.com

A static personal website for `dilanbhat.com`, published from
`dilanbhat/dilanbhat.github.io` with GitHub Pages.

## Local Preview

Open `index.html` in a browser, or run a tiny local server:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

BioSphere is available locally at:

```text
http://localhost:8000/biosphere/
```

The original `UnitGame` Java prototype is preserved in `biosphere/src/`.

## GitHub Pages Setup

This repo includes `.github/workflows/pages.yml`, which deploys the static site
with GitHub Actions whenever changes are pushed to `main`.

To enable it in GitHub:

1. Go to **Settings -> Pages** for this repository.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. Push to `main`, then wait for the **Deploy GitHub Pages** workflow to finish.

The `CNAME` file sets the custom domain to `dilanbhat.com`. BioSphere is
published at:

```text
https://dilanbhat.com/biosphere/
```
