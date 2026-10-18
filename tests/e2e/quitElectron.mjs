// Passed directly to ElectronApplication.evaluate; keep this callback self-contained.
export function quitElectron({ app }) {
  // Inspector evaluation can interrupt a native BrowserWindow constructor.
  // Let that stack unwind before Electron closes its window list.
  setImmediate(() => app.quit());
}
