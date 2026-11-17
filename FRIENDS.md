# logto-friends

A personal fork of [Logto](https://github.com/logto-io/logto) with small edits for my own use. For Logto itself, see the [upstream README](README.md).

## Branches

- `friends`: the default branch. It carries every fork commit, and prod builds from it.
- `master`: an exact mirror of `upstream/master`. Never commit to it.
- `friends` only takes upstream **release tags** (`vX.Y.Z`), never `upstream/master`. Unreleased upstream database migrations (`next-*`) can still be edited, reordered or reverted before release. Running them on prod's database can leave its schema permanently different from upstream's.

Remotes: `origin` is this fork, and `upstream` is `logto-io/logto` (push disabled).

## Bringing in upstream

Run these steps on a schedule (checking once a week is plenty; Logto releases every few weeks), or by hand. Each step says when to stop. When run unattended, stop at any STOP and report back. Don't push or deploy past one.

### 1. Find the new release

```sh
git switch friends && git status --short          # must be clean
git fetch upstream --tags
NEW=$(git tag -l 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
OLD=$(git describe --tags --abbrev=0 --match 'v[0-9]*' friends)
echo "$OLD -> $NEW"
git merge-base --is-ancestor "$NEW" friends && echo "up to date"   # done, nothing to do
```

### 2. Read what changed

```sh
gh release list -R logto-io/logto --limit 5        # then `gh release view <tag>` for each one after OLD
git diff --stat "$OLD" "$NEW" -- packages/schemas/alterations
```

STOP if the notes mention breaking changes, required manual steps or a new major version.

### 3. Check the migrations

The database records only the timestamp of the newest migration it has run. `alteration deploy` runs every migration file with a newer timestamp. An upstream migration older than a fork migration that has already run would be **skipped silently**.

```sh
# Upstream migrations in this release must all be newer than every fork migration.
ts() { sed -nE 's#^(.*/)?[^-/]+-([0-9]+)[.-].*#\2#p' | sort -n; }
FORK_MAX=$(ls packages/schemas/alterations | grep -- '-friends-' | ts | tail -1)
UPSTREAM_MIN=$(git diff --name-only --diff-filter=A "$OLD" "$NEW" -- packages/schemas/alterations | ts | head -1)
echo "fork newest: ${FORK_MAX:-none}  upstream oldest new: ${UPSTREAM_MIN:-none}"
```

STOP if both are set and `UPSTREAM_MIN` is lower than `FORK_MAX`. Also STOP if any `next-*` file shows up in `packages/schemas/alterations`. A release tag should never contain one.

### 4. Merge

```sh
git push origin "upstream/master:refs/heads/master"   # keep the mirror current
git merge --no-ff "$NEW" -m "chore: merge upstream $NEW"
```

Conflicts:

- `pnpm-lock.yaml`: take upstream's (`git checkout --theirs pnpm-lock.yaml`), then run `pnpm install` to re-add fork dependencies, and stage the result.
- `AGENTS.md`: keep upstream's text and the fork section at the bottom.
- Anything else: keep the fork's intent with as little diff against upstream as possible. STOP if a resolution needs a judgement call about product behaviour.

`rerere` is on, so a resolution you've already made is reused.

### 5. Verify

```sh
pnpm install --frozen-lockfile
pnpm prepack                                      # builds every package
docker build -t logto-friends:check .             # the same build prod runs
```

For a fork change to schemas or core, also run that package's tests (`pnpm -F @logto/core test`). STOP on any failure. Don't push a broken `friends`.

### 6. Push

```sh
git push origin friends
```

### 7. Deploy

Done by hand, from `~/compose/infra/logto`. Take a backup first, because migrations can't be undone:

```sh
mkdir -p ~/backups
docker exec logto-postgres-1 pg_dump -U postgres -Fc logto > ~/backups/logto-$(date +%F).dump
```

Then rebuild and recreate the server. The `pre_start` hooks run `alteration deploy latest` before Logto starts. Check `docker logs logto-server-1` and sign in once.

Until prod builds from this fork, it runs the stock `ghcr.io/logto-io/logto:1` image, which moves to each new release on pull. Steps 1 to 6 still keep `friends` in step with it.

## Fork rules

- Keep fork changes in new files where possible, and keep edits to upstream files small. Don't let Prettier reformat untouched parts of shared files.
- No changesets and no `isDevFeaturesEnabled` guards for fork changes. Those belong to upstream's release process.
- Don't change Logto's own schema if you can avoid it. Use `custom_data` (jsonb) on users, applications or organizations, or `logto_configs`. If the fork needs its own tables, put them in a separate Postgres schema that Logto's migration runner doesn't know about.
- If a fork migration is unavoidable:
  - Name it `<current release>-<timestamp>-friends-<name>.ts`, e.g. `1.46.0-1793585969-friends-add-foo.ts`. A non-semver prefix is dropped by version-targeted deploys.
  - Its timestamp is **the newest existing migration's timestamp + 1, never the current time**. Upstream migrations written later then always sort after it.
  - Update the matching `packages/schemas/tables/*.sql` too, because fresh installs and generated types come from there.
  - Once it has run on prod, never edit it. Add a new migration instead.
