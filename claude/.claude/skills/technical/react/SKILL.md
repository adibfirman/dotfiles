---
name: react
description: Use when working with React, Next.js, React component architecture, React performance, or React Native.
---

# React Skill Router

Use this skill for React-family work.

## Delegate to child skills

Use `react-best-practices` for:
- React rendering performance
- Next.js data fetching
- bundle optimization
- server/client component decisions
- avoiding unnecessary `useEffect`

Use `react-native-best-practices` for:
- React Native performance
- Hermes
- bridge overhead
- animations
- FlashList
- JS thread blocking

Use `composition-patterns` for:
- compound components
- render props
- reusable component APIs
- boolean prop cleanup
- flexible component architecture

## Default behavior

Prefer composition over boolean prop proliferation.
Avoid `useEffect` unless synchronizing with an external system.
Keep components small and data flow explicit.
