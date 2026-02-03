---
description: Remove AI code slop
agent: build
---

Check the diff against main, and remove all AI generated slop introduced in this branch. Look for overly verbose comments, unnecessary abstractions, redundant null checks, excessive error handling boilerplate, and other patterns typical of LLM-generated code that add noise without value.
