# Releasing

Pushing a version tag publishes that version to npm from GitHub Actions
([`.github/workflows/publish.yaml`](../.github/workflows/publish.yaml)).

```bash
npm version patch   # or minor / major: bumps package.json, commits, tags vX.Y.Z
git push --follow-tags
```

The workflow refuses a tag that does not match `package.json`, runs `npm run check`
through `prepublishOnly`, and publishes with provenance.

## One-time setup

The workflow authenticates with npm trusted publishing (OIDC), so no npm token is stored.
On npmjs.com, open the `genaicode` package, then Settings → Trusted publishing, and add a
GitHub Actions publisher:

- Organization or user: `gtanczyk`
- Repository: `genaicode`
- Workflow filename: `publish.yaml`
- Environment: `npm`

The `npm` environment also exists in the repository's Settings → Environments, where it can
require a reviewer or restrict which tags may deploy.
