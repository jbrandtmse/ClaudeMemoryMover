# Installing the cmemmov binary

The pre-built binaries let you run `cmemmov` without installing Node.js. Four binaries are produced by CI for every release:

| Platform | Arch  | Binary                         |
| -------- | ----- | ------------------------------ |
| Windows  | x64   | `cmemmov-windows-x64.exe`      |
| macOS    | arm64 | `cmemmov-macos-arm64`          |
| macOS    | x64   | `cmemmov-macos-x64`            |
| Linux    | x64   | `cmemmov-linux-x64`            |

For users who already have Node ≥ 22, `npm install -g cmemmov@next` is simpler — see [the README](../README.md#install). The binaries exist so users without a Node.js install can still run cmemmov on every supported OS.

## 1. Download

Every tagged release attaches all four binaries to its GitHub Release page. The simplest source is the **latest** release URL:

<https://github.com/jbrandtmse/ClaudeMemoryMover/releases/latest>

Pick the binary that matches your OS and architecture from the **Assets** section of that release. The four assets are named exactly as the table above. No extra archives, no installers — each asset is a single executable file.

To download a specific historical release instead, browse <https://github.com/jbrandtmse/ClaudeMemoryMover/releases> and pick the tag you want.

## 2. Per-platform first run

### Windows

No extra steps. Double-click the `.exe` or run it from PowerShell / CMD.

```powershell
.\cmemmov-windows-x64.exe --version
```

### Linux

The build script sets the executable bit, but binaries downloaded via a web browser sometimes lose it. Re-add it if needed:

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

The binary is **ad-hoc signed** (`codesign --sign -`), not Developer-ID signed. macOS will still let you run it after the `xattr` step, but Apple's Notarization service is intentionally bypassed.

**Why ad-hoc only:** Proper Apple Developer ID signing requires a paid Developer Program membership and a Notarization upload step. That's scoped as a v1.0 milestone — see [`deferred-work.md`](../_bmad-output/implementation-artifacts/deferred-work.md) under "v1.0 milestones".

## 3. Verify the install

Once the binary runs, two quick checks confirm it's intact:

```sh
./cmemmov-linux-x64 --version
./cmemmov-linux-x64 --help
```

`--version` prints a SemVer string. `--help` prints the top-level usage banner with the six subcommands (`export`, `import`, `fix-paths`, `share`, `rollback`, `completion`). If either fails — wrong checksum, partial download, OS architecture mismatch — re-download from the GitHub Releases page and check that the asset filename matches your platform exactly.

For a deeper sanity check, run any subcommand's `--help`:

```sh
./cmemmov-linux-x64 export --help
./cmemmov-linux-x64 share --help
```

These exercise the lazy-import dispatcher and prove the bundled chunks loaded correctly.

## 4. Put it on `PATH`

The binary works fine from any directory, but most users want to call it as `cmemmov` from anywhere. Drop the binary on a directory already on your `PATH`, optionally renaming it to `cmemmov` (or `cmemmov.exe` on Windows).

### Windows — adding to `%PATH%`

Copy the executable to a directory that's already on `%PATH%`. The common per-user location is `%USERPROFILE%\bin\` (create it if it doesn't exist, then add it to `PATH` via **System Properties → Environment Variables → User variables → Path → Edit → New**):

```powershell
mkdir $env:USERPROFILE\bin
Copy-Item .\cmemmov-windows-x64.exe $env:USERPROFILE\bin\cmemmov.exe
# After adding %USERPROFILE%\bin to PATH and reopening the shell:
cmemmov --version
```

### macOS and Linux — adding to `PATH`

For a system-wide install (requires `sudo`):

```sh
sudo mv ./cmemmov-macos-arm64 /usr/local/bin/cmemmov
sudo chmod +x /usr/local/bin/cmemmov
cmemmov --version
```

For a per-user install (no `sudo`):

```sh
mkdir -p ~/.local/bin
mv ./cmemmov-linux-x64 ~/.local/bin/cmemmov
chmod +x ~/.local/bin/cmemmov
# Ensure ~/.local/bin is on PATH (it is by default on most modern distros):
echo $PATH | tr ':' '\n' | grep -q "$HOME/.local/bin" || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
cmemmov --version
```

After putting the binary on `PATH`, the rest of the README's commands work as written — drop the `./` prefix.

## 5. Next steps

Once cmemmov is installed, the [README](../README.md) covers the six commands. Before running any write command (`import`, `fix-paths`, `rollback`), quit Claude Code first — see the [Known Limitations](../README.md#known-limitations) section for why.

For shell tab completion, run `cmemmov completion <shell>` and follow the instructions printed for your shell.
