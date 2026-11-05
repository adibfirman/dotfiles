---
name: technical
description: Use when working on software engineering tasks.
---

# About

If we read, write, or review any code, we need to check these reference skills below:

- [composition-patterns](./react/composition-patterns/) -- React component composition patterns. Use it for both ReactJS and React Native projects.
- [react-best-practices](./react/react-best-practices/) -- For ReactJS code.
- [react-native-best-practices](./react/react-native-best-practices/) -- For React Native code.
- [react-native-skills](./react/react-native-skills/) -- React Native and Expo performance rules: lists, animations, navigation, native modules.
- [react-view-transitions](./react/react-view-transitions/) -- React View Transition API: page, route, and shared element animations.
- [golang-how-to](./golang/golang-how-to/) -- When working in the golang language. It is the upstream router and loads the Go skills that match the task.
  - `golang-lint` is not installed. Skip it when `golang-how-to` lists it.
- [test-audit](./test-audit/) -- Test value rules for any language. Use it when you write, change, or review a test. Use it before the language testing skill, for example `golang-testing`.
  - Skip the links to `docs/help/testing/writing-tests.md` and `openclaw-testing`. They exist only in the OpenClaw repo.
  - Skip the OpenClaw commands, for example `pnpm deadcode:*` and `scripts/check-changed.mjs`. Use the test and lint commands of the current repo.
  - Read "autoreview" as `/code-review`.
  - Read `CAMPAIGN.md` only when the user asks to prune all tests of one subsystem.
  - When you write a new test or change an existing test case, make one small change to the production code that still builds, for example flip a condition. Confirm the test fails on its assertion, not on a build error. Then restore the code byte for byte and check `git diff`.
- [design-thinking](./design-thinking/) -- Concept checklist for program flow and UI flow. Use it when you write a spec or a plan before code, and when you review a design.
