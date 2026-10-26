## What and why

<!-- What changes, and why. Link the issue if there is one. -->

## Checklist

- [ ] `npm run format:check`, `npm run lint`, `npm run typecheck` and `npm test` pass
- [ ] New or changed behavior has a unit test (a bug fix has one that fails without the fix)
- [ ] Public API changed? Snapshot updated (`UPDATE_API_SNAPSHOT=1 npm test`) and `CHANGELOG.md` has a line
- [ ] No personal data, no game dumps, no real packets; fixtures are invented
- [ ] Anything that sends commands fails closed when it does not know
