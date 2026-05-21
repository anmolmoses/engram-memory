---
name: deploy-rollback-rule
description: Never skip the database migration step during a deploy; it caused a production outage
importance: 9
metadata:
  type: semantic
---
Production broke once when a deploy shipped application code that expected a new column before the database migration had run. The fix was an emergency rollback. The durable lesson: migrations run before (or atomically with) the code that depends on them, never after.

**How to apply:** Gate deploys on a "migrations applied" check. If a deploy can race the migration, treat that as a release blocker.
