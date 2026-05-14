# Installing the cmemmov binary

> **Stub note (Story 5.2):** This is the install-flow stub. Story 5.4 owns
> full user-facing documentation; this page covers just the mechanical steps
> needed to run a downloaded binary.

The pre-built binaries let you run `cmemmov` without installing Node.js.
Four binaries are produced by CI for every release:

| Platform | Arch  | Binary                         |
| -------- | ----- | ------------------------------ |
| Windows  | x64   | `cmemmov-windows-x64.exe`      |
| macOS    | arm64 | `cmemmov-macos-arm64`          |
| macOS    | x64   | `cmemmov-macos-x64`            |
| Linux    | x64   | `cmemmov-linux-x64`            |

## 1. Download

Pre-built binaries will be published to the GitHub Releases page once the
release pipeline (Story 5.3) lands. Until then, build locally with
`npm run build && npm run build:binary` — the binary lands at
`dist/binaries/cmemmov-<platform>-<arch>(.exe)?`.

## 2. Per-platform first run

### Windows

No extra steps. Double-click the `.exe` or run it from PowerShell / CMD.

```powershell
.\cmemmov-windows-x64.exe --version
```

### Linux

The build script sets the executable bit, but binaries downloaded via a
web browser sometimes lose it. Re-add it if needed:

```sh
chmod +x cmemmov-linux-x64
./cmemmov-linux-x64 --version
```

### macOS (arm64 and x64)

Two steps the first time:

```sh
# Remove Gatekeeper's quarantine flag (binaries downloaded from the web
# are quarantined by default until the user explicitly approves them).
xattr -d com.apple.quarantine ./cmemmov-macos-arm64

# Run it.
./cmemmov-macos-arm64 --version
```

The binary is **ad-hoc signed** (`codesign --sign -`), not Developer-ID
signed. macOS will still let you run it after the `xattr` step, but Apple's
Notarization service is intentionally bypassed.

**Why ad-hoc only:** Proper Apple Developer ID signing requires a paid
Developer Program membership and a Notarization upload step. That's
scoped as a v1.0 milestone — see
[`deferred-work.md`](../_bmad-output/implementation-artifacts/deferred-work.md)
under "v1.0 milestones".

## 3. Sanity check

Once the binary runs, the same commands described in the main
[`README`](../README.md) work:

```sh
./cmemmov-linux-x64 --help
./cmemmov-linux-x64 export --help
```
