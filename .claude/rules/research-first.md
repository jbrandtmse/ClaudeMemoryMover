## Brief overview
- "Research First": when not 100% certain about a technical point, research with Perplexity MCP before deciding or coding.
- Keep research focused, cite authoritative sources, and convert findings into precise implementation steps.

## When to research
- Uncertainty about API, library, or framework signatures, adapters, or configuration.
- Language syntax or semantics you don't fully recall.
- Conflicting memories, ambiguous forum answers, or gaps in best practices.

## How to use Perplexity MCP effectively
- Use specific, context-rich prompts: include the framework/language, feature name, and any known error code.
- Prefer `search` for broad discovery, `get_documentation` for targeted docs, `check_deprecated_code` to validate outdated patterns.
- Iterate with follow-up questions if results conflict or lack clarity.

## Sources and citation
- Prioritize official docs, vendor publications, and highly reputable community sources.
- Provide 2–4 authoritative links with a one-line rationale per link.
- Quote short key lines only when they directly impact implementation decisions.

## From research to action
- Summarize decisions as bullets before coding (what to change and why).
- Map each decision to a concrete step at file/function level.
- Validate changes with the project's available test or compile tools.

## Escalation
- If sources disagree, summarize the conflict and propose the safest standards-compliant approach.
- If uncertainty persists after one research pass, ask one targeted clarifying question to unblock.

## Deliverable format
- Brief summary of findings (1–3 bullets)
- Decision list (actionable bullets)
- Source links (2–4) and any decisive short quotes
- Adjusted code snippet(s) reflecting the researched guidance
