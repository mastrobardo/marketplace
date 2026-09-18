# Repository identity — personal only

This repository is **personal**. It must never carry a work identity.

| | Value |
|---|---|
| Commit author | `mastrobardo <mastrobardo@gmail.com>` |
| Remote | a repo owned by the **personal** GitHub account — never `davide-arcinotti_iagl` or any `parserdigital` account |
| Tokens / MCP | a PAT issued by the personal account only |

## Enforcement
- **Repo-local git config** (already set): `user.email=mastrobardo@gmail.com`, `user.name=mastrobardo`.
  The machine's global config is a work address and is deliberately overridden here, not changed.
- **Pre-commit hook** (`.githooks/pre-commit`, enabled via `core.hooksPath`): blocks any commit whose
  `user.email` is not the personal address, and blocks a work-looking `origin`.
- **CI gate `author-identity`** (`W0-T21`, live since `W0-T12`; a step of the `gates` job since
  `W0-T29`): fails a PR if any commit author email is not `mastrobardo@gmail.com`. The committer is
  checked too — `git commit --author` sets only the author — **except when the committer is
  `noreply@github.com`**, which is GitHub itself: a squash merge, the "Update branch" button and a
  web-UI edit are all committed by the platform and leave the author untouched, so that trailer is
  not evidence about anybody's identity. Merge commits are skipped (`--no-merges`). Unlike the hook
  above, it cannot be bypassed.

## Known trap on this machine
Both the `gh` CLI and the SSH key at `~/.ssh/id_ed25519` currently authenticate as
**`davide-arcinotti_iagl`** (work). A plain `gh repo create` or `git push` would therefore publish
under the work account. Before the first push, the personal account must be added:

```sh
gh auth login            # choose the personal account; gh keeps both and lets you switch
gh auth switch --user <personal-login>
```

or push over HTTPS with a personal PAT, or add a personal SSH key with a dedicated host alias in
`~/.ssh/config`. Verify with `ssh -T git@github.com` / `gh api user --jq .login` before pushing.
