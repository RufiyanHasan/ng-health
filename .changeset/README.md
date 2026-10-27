# Changesets

Each user-facing change adds a small Markdown file here describing it and its semver bump
(`npx changeset`). On merge to `main`, the release workflow turns pending changesets into a
"chore: version packages" pull request that bumps `package.json` and updates `CHANGELOG.md`;
merging that PR publishes to npm. See CONTRIBUTING.md.
