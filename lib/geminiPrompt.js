// Pure helper: builds the prompt sent to Gemini. No network calls here,
// so the future /api/summarize route can import it as-is.

export function buildIncidentPrompt({ stackTrace, actions, codeDiff }) {
  const steps = actions
    .map((a, i) => `${i + 1}. ${a.type} ${a.target}${a.value ? ` = "${a.value}"` : ''}`)
    .join('\n');

  return `You are an on-call engineer writing an incident summary for a non-expert audience.

Using the stack trace, the user's last ${actions.length} actions, and the code diff from the fix,
reply with ONLY a JSON object with these keys, each 1–2 plain-English sentences:
  "whatBroke"    - what failed in the code
  "whyTriggered" - how the user's steps led to the crash
  "howFixed"     - how the code diff fixes it

STACK TRACE:
${stackTrace}

USER ACTIONS (oldest first):
${steps}

CODE DIFF:
${codeDiff ?? '(no patch yet)'}`;
}
