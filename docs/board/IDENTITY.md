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
- **CI gate `author-identity`** (`W0-T21`, live since `W0-T12`): fails a PR if any commit author or
  committer email is not `mastrobardo@gmail.com`. Both trailers are checked — `git commit --author`
  sets only the author. Merge commits are skipped (`--no-merges`), so GitHub's "Update branch"
  button cannot fail a branch the author never mis-signed. Unlike the hook below, it cannot be
  bypassed.

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
