import * as vscode from 'vscode';
import { BlpEditorProvider } from './blpEditorProvider';

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(BlpEditorProvider.register(context));
}

export function deactivate(): void {}
