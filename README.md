# Dilan Bhat

A simple static personal website built for GitHub Pages.

Update the homepage copy and contact links in `index.html` when you are ready
to make it more personal.

## Local Preview

Open `index.html` in a browser, or run a tiny local server:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

BioSphere is available locally at:

```text
http://localhost:8000/site/biosphere/
```

## GitHub Pages Setup

This repo includes `.github/workflows/pages.yml`, which deploys the static site
with GitHub Actions whenever changes are pushed to `main`.

To enable it in GitHub:

1. Go to **Settings -> Pages** for this repository.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. Push to `main`, then wait for the **Deploy GitHub Pages** workflow to finish.

Because the remote is currently `dilanbhat/dilanbhat02.github.io`, GitHub will
publish it as a project site unless this repository is moved to the `dilanbhat02`
account. Project-site URL:

```text
https://dilanbhat.github.io/dilanbhat02.github.io/
```

If you want the root user-site URL `https://dilanbhat02.github.io/`, the
repository must be named `dilanbhat02.github.io` under the `dilanbhat02` GitHub
account.
