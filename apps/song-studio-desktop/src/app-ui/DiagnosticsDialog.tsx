import { useMemo, useState } from 'react';
import { buildDiagnostics, defaultDiagnosticsOptions, type DiagnosticsInput, type DiagnosticsOptions } from '../app/diagnostics';

// DIAGNOSTICS EXPORT (ALPHA-001 §11). The creator sees EXACTLY what will leave
// their computer before anything is written. Optional extras are unchecked by
// default and are still redacted for secrets when included.

export function DiagnosticsDialog({ input, onExport, onClose }: {
  input: DiagnosticsInput;
  /** Writes the package; returns where it went. */
  onExport: (files: Array<{ relPath: string; content: string }>) => Promise<string | null>;
  onClose: () => void;
}) {
  const [opts, setOpts] = useState<DiagnosticsOptions>(defaultDiagnosticsOptions());
  const [busy, setBusy] = useState('');
  const pkg = useMemo(() => buildDiagnostics(input, opts), [input, opts]);
  const toggle = (k: keyof DiagnosticsOptions) => setOpts((o) => ({ ...o, [k]: !o[k] }));

  const doExport = async () => {
    setBusy('Writing the diagnostics package…');
    try {
      const dest = await onExport(pkg.files);
      setBusy(dest ? `Saved to ${dest}. Send that folder along with a short note about what you were doing.` : 'Export cancelled.');
    } catch (e) {
      setBusy(`Could not write the package: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="dir-modal" onClick={onClose}>
      <div className="dir-packet" onClick={(e) => e.stopPropagation()}>
        <div className="dir-packet-head">
          <h3>Help us fix a problem</h3>
          <button className="ghost small" onClick={onClose}>Close</button>
        </div>

        <p className="muted small">Song Studio never sends anything on its own. This writes a folder you can look at and then send to us yourself.</p>

        <h4>Preview — exactly what will be exported</h4>
        <pre className="dir-pre diag-preview">{pkg.preview}</pre>

        <h4>Optional extras</h4>
        <p className="muted small">Off by default. Only tick these if we asked you to — they can contain your creative work. API keys are never included either way.</p>
        <div className="diag-opts">
          <label><input type="checkbox" checked={opts.includeSceneSummary} onChange={() => toggle('includeSceneSummary')} /> Include the current scene summary <span className="muted small">(may contain lyrics and direction)</span></label>
          <label><input type="checkbox" checked={opts.includeCompiledPacket} onChange={() => toggle('includeCompiledPacket')} /> Include the exact compiled packet <span className="muted small">(the full prompt sent to the provider)</span></label>
          <label><input type="checkbox" checked={opts.includeMediaFiles} onChange={() => toggle('includeMediaFiles')} /> Include media file names <span className="muted small">(names only — never the audio or video itself)</span></label>
        </div>

        <h4>Files</h4>
        <ul className="dir-list">{pkg.files.map((f) => <li key={f.relPath}><code>{f.relPath}</code></li>)}</ul>

        <div className="dir-generate-bar">
          <button className="ghost small" onClick={onClose}>Cancel</button>
          <button className="primary small" onClick={doExport}>Export diagnostics…</button>
        </div>
        {busy && <div className="dir-busy small">{busy}</div>}
      </div>
    </div>
  );
}
