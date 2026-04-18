# BLP Previewer

A Visual Studio Code extension that lets you open and preview **BLP2 texture files** directly in the editor — no external tools needed.

BLP2 is a proprietary texture format used by Blizzard Entertainment in games such as *World of Warcraft*, *StarCraft II*, and others.

## Features

- Opens `.blp` files as a custom read-only editor
- Supports all major BLP2 encoding types:
  - **DXT1** (opaque and punch-through alpha)
  - **DXT3** (explicit 4-bit alpha)
  - **DXT5** (interpolated alpha)
  - **Palettized** (256-color with 0/1/4/8-bit alpha)
  - **Uncompressed ARGB**
- Displays image dimensions
- Checkerboard background to visualise transparency
- Pure TypeScript — no native dependencies

## Installation

### From VSIX (recommended)

1. Download the latest `.vsix` from the [Releases](../../releases) page
2. In VS Code: **Extensions** → `...` menu → **Install from VSIX…**

Or via the command line:
```bash
code --install-extension blp-previewer-<version>.vsix
```

### Build from source

```bash
git clone https://github.com/BoAW/BLP_Previewer.git
cd BLP_Previewer
npm install
npm run compile
```

Press **F5** to launch an Extension Development Host with the extension loaded.

To package:
```bash
npm install -g @vscode/vsce
vsce package
```

## Usage

Open any `.blp` file in VS Code. The extension automatically activates and renders the texture in a webview panel.

## BLP2 Format Support

| Encoding | Alpha type | Supported |
|----------|-----------|-----------|
| DXT1     | Opaque    | ✅ |
| DXT1     | Punch-through (1-bit) | ✅ |
| DXT3     | Explicit 4-bit | ✅ |
| DXT5     | Interpolated 8-bit | ✅ |
| Palettized | 0/1/4/8-bit | ✅ |
| Uncompressed ARGB | — | ✅ |
| JPEG (type 0) | — | ❌ (rare, not supported) |
| BLP1 | — | ❌ (out of scope) |

## Project Structure

```
src/
├── extension.ts          # Extension entry point
├── blpEditorProvider.ts  # Custom editor provider & webview host
└── blp2Parser.ts         # BLP2 binary parser (DXT1/3/5, palette, ARGB)
```

## License

[MIT](LICENSE)