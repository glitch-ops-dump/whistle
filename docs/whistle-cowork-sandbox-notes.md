# Cowork sandbox dev notes — environment quirks and how they were solved

Working notes from the 2026-06-11/12 UX-audit and Phase-0 sessions. Whistle development in Claude Cowork runs the shell in an **isolated Linux ARM64 VM** with the repo folder mounted; this VM is not the user's Mac. Every quirk below comes from that split.

## 1. `git push` fails: "could not read Username for https://github.com"

**Why.** Three separate things are all called "GitHub connected", and none of them gives the sandbox shell push rights:

| Layer | State | Can push? |
|---|---|---|
| macOS git credentials (Keychain / gh CLI on the Mac) | Connected for the *user* | Not visible to the sandbox VM by design — credential isolation |
| GitHub MCP plugin (Copilot API) | Installed, but OAuth not completed in-session (only `authenticate` stub tools exposed) | After OAuth, only via API calls — see warning below |
| Sandbox VM git | No token, no credential helper, no `~/.ssh` key, no agent (`SSH_AUTH_SOCK` empty) | No |

**Diagnosis path (repeatable).**
1. `git push` → `could not read Username` → no HTTPS credentials.
2. `env | grep -i proxy` → `GIT_SSH_COMMAND=ssh -o ProxyCommand='socat - PROXY:localhost:%h:%p,proxyport=3128'` exists, so SSH *transport* is provisioned.
3. SSH push attempt #1 → `Host key verification failed` (no known_hosts, no tty). Fix: `-o StrictHostKeyChecking=accept-new`.
4. SSH push attempt #2 → reaches GitHub, fails with `Permission denied (publickey)` → transport works, identity doesn't exist in the VM.

**Resolution.** The mounted folder *is* the real local repo, so commits made in-session are already on the user's disk. The clean fix is simply pushing from the Mac:

```bash
git push origin main
```

Alternatives, in order of preference: (a) complete the GitHub MCP plugin OAuth — but its API "push" tools create *new* commits server-side, which would diverge from the local SHAs; only use for repos not mounted locally; (b) provision a fine-grained PAT (repo `glitch-ops-dump/whistle`, permission **Contents: Read & write**, from https://github.com/settings/personal-access-tokens/new) into the sandbox env.

## 2. Vite won't start: missing `@rolldown/binding-linux-arm64-gnu`

`node_modules` was installed on macOS (darwin-arm64); the VM is linux-arm64. Fix without touching the user's lockfile:

```bash
RV=$(node -p "require('./node_modules/rolldown/package.json').version")
npm i --no-save @rolldown/binding-linux-arm64-gnu@$RV
```

## 3. Vite EPERM deleting `node_modules/.vite` cache

Mounted-folder deletes are blocked until explicitly allowed. Workaround: run vite with a wrapper config that points `cacheDir` at VM-local disk (and imports vite/plugin-react by **absolute path** into `node_modules`, since a config outside the repo can't resolve bare specifiers):

```ts
// /tmp/wx/vite.sandbox.config.ts
import { defineConfig } from "<repo>/node_modules/vite/dist/node/index.js";
import react from "<repo>/node_modules/@vitejs/plugin-react/dist/index.js";
export default defineConfig({ root: "<repo>", cacheDir: "/tmp/wx/vite-cache", plugins: [react()] });
```

## 4. Background servers die between shell calls

The sandbox reaps **all** processes when each bash invocation ends — `nohup`/`setsid` don't survive. Pattern that works: one self-contained script per invocation that *spawns the dev server + API, waits for health, does its work, exits* — sized to finish inside the 45s call timeout (batch 1–2 pages per call for browser work).

Also: never `pkill -f <script>` — the pattern matches the shell running the command itself (the string is in its own cmdline) and kills it (exit 143).

## 5. Headless Chromium: `libXdamage.so.1` missing, no root, mirror blocked

`apt` has no root and the package mirror is outside the network allowlist. Since headless mode never exercises the XDamage X11 extension, a stub library satisfies the loader:

```bash
nm -D headless_shell | grep -i damage   # → XDamageCreate/Destroy/QueryExtension/Subtract
cat > stub.c <<'EOF'
int XDamageCreate(void){return 0;} void XDamageDestroy(void){}
int XDamageQueryExtension(void){return 0;} void XDamageSubtract(void){}
EOF
gcc -shared -fPIC -o /tmp/libs/x/libXdamage.so.1 -Wl,-soname,libXdamage.so.1 stub.c
LD_LIBRARY_PATH=/tmp/libs/x node capture.mjs
```

Check `ldd headless_shell | grep "not found"` first — only stub what's actually missing.

## 6. Tamil renders as tofu in sandbox screenshots

The VM has no Tamil fonts (`fc-list | grep -ci tamil` → 0). This is an environment artifact, **not** a product bug — but it mirrors the real risk tracked as UX item 2.5 (bundle a Noto Sans Tamil subset; the app currently relies on system fonts only).

## 7. File deletes in the mounted repo

`rm` → `Operation not permitted` until delete permission is granted for the folder (one-time approval via the Cowork delete-permission prompt). After approval, deletes work normally.
