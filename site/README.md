# Proof landing page

This directory is the hosted Sites checkout. The original local Proof workspace stays in the parent directory.

`npm run build` builds the existing landing page and its waitlist Worker. `npm test` checks the persistent signup and rate-limit queries against the generated SQLite schema. `npm run db:generate` generates migrations after a schema change.

Sites owns the production `DB` database. Email signups live in the `waitlist` table. This page records permission for early-access updates and does not send email. No local signup data or product credentials are included in this deployment.
