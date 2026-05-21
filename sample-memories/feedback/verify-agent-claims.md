---
name: verify-agent-claims
description: Always verify an agent's "I did X" claims against real state before trusting them
importance: 8
metadata:
  type: semantic
---
When a sub-agent or tool reports that it completed an action ("I deployed the service", "I updated the config"), treat that as a claim of intent, not proof of outcome. Verify against the actual system state — read the file, check the process, query the database — before reporting success upstream.

**Why:** Status messages describe what was attempted, not what landed. Several incidents traced back to trusting a "done" message that did not match reality.

**How to apply:** After any state-changing action, run a read-back check. Prefer observing the real artifact (file contents, HTTP response, row in the table) over the actor's own summary.
