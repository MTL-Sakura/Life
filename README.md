# Life

This repository has been reset intentionally.

The previous Sakura Life implementation was removed from the current `main`
branch so the project can restart from a clean slate while keeping Git history.

## Status

- Old application code has been removed from Git.
- Git history is preserved, so previous work can still be recovered if needed.
- Server files tracked by Git will be removed on the next `git pull`.
- Server-only files such as `.env`, `node_modules`, `.next`, logs, and process
  state are not managed by this reset commit.
- MySQL data is not changed by `git pull`. Future versions should handle schema
  changes through migrations or an explicit database reset.

## Next Step

Design the new product direction before adding code again.
