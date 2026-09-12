# Space

Space puts coding agents, terminals, browsers, files, diffs, and notes on one canvas. Each task has its own workspace and saved layout. Projects group related workspaces, so you can switch tasks without rebuilding their context.

## Why Space

Coding agents can work on several tasks at once, but your attention still moves between them. Each task spreads across terminal windows, browser tabs, editors, and conversations. When you return, you have to find those pieces and remember where you stopped.

Space keeps the tools and information for a task in one stable layout. The canvas makes the workspace itself a reminder of what belongs together. Research into [programming-task resumption](https://sites.cc.gatech.edu/reverse/repository/resumptionstrategies.pdf), [contextual cues](https://www.microsoft.com/en-us/research/publication/evaluating-cues-for-resuming-interrupted-programming-tasks/), and [spatial memory](https://www.microsoft.com/en-us/research/publication/data-mountain-using-spatial-memory-for-document-management/) motivates this design.

## Development

```bash
vp install
vp run dev
```

Run these checks before submitting a change:

```bash
vp check
vp test
vp run test:e2e
vp run build
```

Create a desktop package with:

```bash
vp run package
```

The packages are written to `apps/desktop/release`.

## License

Space is available under the [MIT License](LICENSE).
# harness-pareto
