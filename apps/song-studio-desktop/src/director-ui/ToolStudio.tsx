import { useState } from 'react';
import type { DirectorCtx } from './context';
import { toolGenerationPrompt, validateToolDefinition, parseToolFromModelText, exportToolPackage, importToolPackage, type ToolValidation } from '../director/toolSchema';
import type { DirectorTool } from '../director/model';
import { ToolFieldRenderer } from './ToolFieldRenderer';

// USER-CREATED AI-GENERATED DIRECTING TOOLS (DEC-003 §5). The creator describes
// a missing directing control; a text model returns a DECLARATIVE definition
// (validated against the allowlist — never executable code); the creator
// previews/refines/installs it. If no text model is configured, the exact
// generation prompt is shown for manual use and a definition can be pasted or
// imported. Local export/import; a shared package installs unchanged.

export function ToolStudio({ ctx }: { ctx: DirectorCtx }) {
  const { state, update } = ctx;
  const [request, setRequest] = useState('');
  const [refinement, setRefinement] = useState('');
  const [proposal, setProposal] = useState<ToolValidation | null>(null);
  const [rawJson, setRawJson] = useState('');
  const [status, setStatus] = useState('');
  const [preview, setPreview] = useState<Record<string, unknown>>({});

  const install = (tool: DirectorTool) => {
    update({ ...state, tools: [...state.tools, tool] });
    setProposal(null); setPreview({}); setStatus(`Installed "${tool.name}". Use it inside a scene.`);
  };

  const generate = async () => {
    if (!request.trim()) return;
    if (ctx.textModelConfigured) {
      setStatus('Asking the text model for a tool definition…');
      const res = await ctx.generateTool(request, refinement || undefined, proposal?.tool ? JSON.stringify(proposal.tool) : undefined);
      setProposal(res);
      setStatus(res.ok ? 'Proposed a tool — preview below.' : `The model response was not a valid tool: ${res.errors.join('; ')}`);
    } else {
      setStatus('No text model configured — copy this exact prompt into any assistant, then paste the JSON below.');
      setRawJson(toolGenerationPrompt(request, refinement || undefined));
    }
  };
  const validatePasted = () => { const res = parseToolFromModelText(rawJson); setProposal(res); setStatus(res.ok ? 'Valid tool — preview below.' : `Invalid: ${res.errors.join('; ')}`); };
  const importPkg = () => { try { const res = importToolPackage(JSON.parse(rawJson), 'pasted-package'); setProposal(res); setStatus(res.ok ? 'Imported a shared tool.' : `Invalid package: ${res.errors.join('; ')}`); } catch { setStatus('Not valid JSON.'); } };

  return (
    <div className="dir-toolstudio">
      <h3>Custom directing tools</h3>
      <p className="muted small">Describe a directing control you wish you had. Song Studio builds a safe, reusable tool from allowlisted pieces — never code.</p>
      <textarea rows={2} placeholder="e.g. I need a way to show the dancer's shoulder, elbow, and hand positions over eight beats." value={request} onChange={(e) => setRequest(e.target.value)} />
      <input placeholder="refine (optional): make the intensity a 1–5 scale" value={refinement} onChange={(e) => setRefinement(e.target.value)} />
      <div className="dir-tool-actions">
        <button className="primary small" onClick={generate}>{ctx.textModelConfigured ? 'Create tool' : 'Show generation prompt'}</button>
        <button className="ghost small" onClick={validatePasted} disabled={!rawJson.trim()}>Validate pasted JSON</button>
        <button className="ghost small" onClick={importPkg} disabled={!rawJson.trim()}>Import package</button>
      </div>
      <textarea className="dir-tool-json" rows={4} placeholder="Paste a tool definition JSON or a shared tool package here…" value={rawJson} onChange={(e) => setRawJson(e.target.value)} />
      {status && <div className="dir-busy small">{status}</div>}

      {proposal?.ok && proposal.tool && (
        <div className="dir-tool-preview">
          <h4>Preview: {proposal.tool.name}</h4>
          <p className="muted small">{proposal.tool.description}</p>
          {proposal.tool.fields.map((f) => (
            <div key={f.id} className="dir-tool-field"><span className="muted small">{f.label}</span>
              <ToolFieldRenderer field={f} value={preview[f.id]} onChange={(v) => setPreview((p) => ({ ...p, [f.id]: v }))} />
            </div>
          ))}
          <button className="primary small" onClick={() => install(proposal.tool!)}>Install into project</button>
        </div>
      )}

      <h4>Installed tools ({state.tools.length})</h4>
      <div className="dir-tool-gallery">
        {state.tools.map((t) => (
          <div key={t.id} className="dir-tool-card">
            <b>{t.name}</b>
            <span className="muted small">v{t.version} · used {t.usageCount}× · {t.appliesTo.join(', ')}</span>
            <div className="dir-tool-card-actions">
              <button className="ghost small" onClick={() => { const pkg = exportToolPackage(t); setRawJson(JSON.stringify(pkg, null, 2)); setStatus('Exported package JSON (copy it to share).'); }}>Export</button>
              <button className="ghost small" onClick={() => update({ ...state, tools: state.tools.filter((x) => x.id !== t.id) })}>Remove</button>
            </div>
          </div>
        ))}
        {state.tools.length === 0 && <div className="muted small">No custom tools yet.</div>}
      </div>
      {!validateToolDefinition({}).ok && null /* keep import referenced */}
    </div>
  );
}
