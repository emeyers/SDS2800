# SDS2800

Interactive apps for the course, hosted on GitHub Pages. They run entirely in
the browser via [shinylive](https://posit-dev.github.io/r-shinylive/) / webR,
so no R server is needed.

## Apps

| App | Live page | Source |
|-----|-----------|--------|
| Gamma distribution ISI / raster demo | https://emeyers.github.io/SDS2800/gamma_app/ | [`apps/gamma_app/app.R`](apps/gamma_app/app.R) |

The first load takes ~10-20 s while webR downloads.

## Layout

- `apps/<name>/app.R` — the Shiny source for each app
- `docs/<name>/` — the exported static site for each app (this is what GitHub
  Pages serves; the Pages source is the `docs/` folder on `main`)

## Adding or updating an app

In R, with the `shinylive` package installed:

```r
shinylive::export("apps/gamma_app", "docs/gamma_app")
```

Then commit and push; GitHub Pages redeploys automatically.
