# Software release version

The root `package.json` version is the application release version. Vite reads it
when starting the frontend development server or building the frontend, and the
sidebar displays it with a `v` prefix. Workspace package versions are independent;
the sidebar does not read `frontend/package.json`.

## Prepare a release on the development computer

From the repository root, run **one** appropriate command:

```powershell
# Bug fixes: 1.0.0 -> 1.0.1
npm version patch --no-git-tag-version --ignore-scripts --workspaces=false

# New features: 1.0.0 -> 1.1.0
npm version minor --no-git-tag-version --ignore-scripts --workspaces=false

# Breaking changes: 1.0.0 -> 2.0.0
npm version major --no-git-tag-version --ignore-scripts --workspaces=false
```

These commands update the root `package.json` and `package-lock.json`. They do not
create a Git commit or tag, run lifecycle scripts, or deploy the application.
Review and commit both files with the release's changes using your normal process.
Increase the version once per release, rather than for every commit or server build.

Restart the frontend development server after changing the version. Production
shows the new version after rebuilding and deploying the frontend with the updated
root package file; pulling source alone does not update an existing container.
Follow the normal deployment playbook, including the HTTPS Compose override.
Do not run version-increment commands on the production VM.

This change only controls the sidebar release label. It does not change database
release markers or the existing backup manifest's version configuration.
