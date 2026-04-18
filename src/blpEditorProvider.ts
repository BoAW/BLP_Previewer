import * as vscode from 'vscode';
import { parseBlp2 } from './blp2Parser';

export class BlpEditorProvider implements vscode.CustomReadonlyEditorProvider {

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            'blpPreviewer.blp',
            new BlpEditorProvider(context),
            { supportsMultipleEditorsPerDocument: false }
        );
    }

    constructor(private readonly context: vscode.ExtensionContext) {}

    async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => { /* nothing to release */ } };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        webviewPanel.webview.options = { enableScripts: true };
        webviewPanel.webview.html = this.buildHtml();

        // Read the .blp file from disk
        const fileBytes = await vscode.workspace.fs.readFile(document.uri);

        try {
            const result = parseBlp2(Buffer.from(fileBytes));
            // Transfer raw RGBA as base64 to avoid large JSON arrays
            const base64 = Buffer.from(result.rgba).toString('base64');
            webviewPanel.webview.postMessage({
                type: 'render',
                width: result.width,
                height: result.height,
                rgba: base64,
            });
        } catch (err) {
            webviewPanel.webview.postMessage({
                type: 'error',
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }

    private buildHtml(): string {
        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #1e1e1e;
      color: #ccc;
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      gap: 10px;
    }

    #canvas-wrap {
      position: relative;
      /* checkerboard background to show transparency */
      background-image:
        linear-gradient(45deg, #444 25%, transparent 25%),
        linear-gradient(-45deg, #444 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #444 75%),
        linear-gradient(-45deg, transparent 75%, #444 75%);
      background-size: 16px 16px;
      background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
    }

    canvas {
      display: block;
      max-width: min(100vw, 1024px);
      max-height: min(100vh - 60px, 1024px);
      image-rendering: pixelated;
    }

    #info  { color: #888; }
    #error { color: #f66; }
  </style>
</head>
<body>
  <div id="canvas-wrap">
    <canvas id="canvas"></canvas>
  </div>
  <div id="info">Loading…</div>
  <div id="error"></div>

  <script>
    const canvas   = document.getElementById('canvas');
    const ctx      = canvas.getContext('2d');
    const infoEl   = document.getElementById('info');
    const errorEl  = document.getElementById('error');

    function base64ToUint8Array(b64) {
      const binary = atob(b64);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;

      if (msg.type === 'render') {
        canvas.width  = msg.width;
        canvas.height = msg.height;
        const imageData = ctx.createImageData(msg.width, msg.height);
        imageData.data.set(base64ToUint8Array(msg.rgba));
        ctx.putImageData(imageData, 0, 0);
        infoEl.textContent = msg.width + ' \u00D7 ' + msg.height + ' px';

      } else if (msg.type === 'error') {
        errorEl.textContent = 'Error: ' + msg.message;
        infoEl.textContent  = '';
      }
    });
  </script>
</body>
</html>`;
    }
}
