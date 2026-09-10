---
name: branch
description: Use when naming, renaming, or reviewing a Git branch.
---

# Name a branch

Use `space/<description>` or `space/<description>-<ticket>`.

1. Describe the intended result of the whole branch without relying on the ticket.
2. Name the affected behavior, screen, service, command, or file. Add a component or condition when it distinguishes the work.
3. Use product and code terms, lowercased to fit the format. Describe the result, unless the implementation itself is the purpose.
4. Replace vague descriptions such as `fix-bug`, `update-code`, `changes`, `cleanup`, and `wip` with the concrete result.
5. Write the description after `space/` in lowercase kebab case. Use only ASCII letters and digits with single hyphens between them.
6. Append an optional ticket after one hyphen. Write it in lowercase and preserve its internal hyphens. A ticket never replaces the description.
7. Check the full name against `^space/[a-z0-9]+(-[a-z0-9]+)*$`.
8. Create or rename the branch only when a reader can tell what it changes and what it affects.

Examples:

- `space/prevent-duplicate-session-refresh`
- `space/show-empty-state-for-missing-search-results-123`
