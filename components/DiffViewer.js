// Minimal unified-diff renderer: red for removed lines, green for added.
function lineKind(line) {
  if (line.startsWith('+++') || line.startsWith('---')) return 'file';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'ctx';
}

export default function DiffViewer({ diff }) {
  if (!diff) {
    return <div className="empty">No patch yet. Gemini's diff appears here once the PR is ready.</div>;
  }

  return (
    <pre className="diff">
      {diff.split('\n').map((line, i) => (
        <div key={i} className={`diff-line diff-${lineKind(line)}`}>
          {line || ' '}
        </div>
      ))}
    </pre>
  );
}
