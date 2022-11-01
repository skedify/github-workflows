# Skedify - GitHub Workflows

Provides reusable GitHub Actions & Workflows.

## Build & Push Docker image workflow:

usage:

```yaml
application:
  uses: skedify/github-workflows/.github/workflows/build-and-push-docker.yml@develop
  with: ...
  secrets: ...
```

For all inputs & secrets, see: https://github.com/skedify/github-workflows/blob/develop/.github/workflows/build-and-push-docker.yml

This command expects the assets to be built for upload to sentry support.
Make sure to pass a `BUILD_COMMAND` if you want to upload sourcemaps.
