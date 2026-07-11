# Team migration dry run

This directory contains an offline analyzer only. It never imports the CloudBase SDK and has no apply mode.

Export the relevant collections to one local JSON object with optional arrays named `teams`, `team_members`, `encouragements`, `team_activity`, and `account_map`. `account_map` must be prepared separately and map legacy `userKey` or `_openid` values to the current account `userId`.

```powershell
node scripts/team-migration-dry-run.js --input .\team-export.json --output .\team-migration-report.json --fail-on-risk
```

The report inventories schema generations, proposes deterministic V2 member IDs, and reports missing account mappings, room-code collisions, and teams above the 20-member limit. It does not generate room codes or mutate exported data because those operations require a separately reviewed online migration job.
