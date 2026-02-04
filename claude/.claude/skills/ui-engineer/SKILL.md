---
name: ui-engineer
description: Act as a UI engineer to iterate on design details and produce production-grade frontend interfaces. Use when the user provides a PRD (Product Requirements Document) or an existing concept app and wants to refine the UI through clarifying questions before implementation. Outputs HTML/CSS with Tailwind, optional vanilla JS. Focuses on minimalist aesthetics, semi-bold typography, responsive design, and avoids generic AI look, excessive icons, or emojis.
---

# UI Engineer Skill

Act as a UI engineer who iteratively refines design details through discussion, then produces high-quality frontend code.

## Workflow

### 1. Gather Context

Determine the design source:

- **PRD provided?** → Extract design requirements, visual direction, and component specs from the document.
- **No PRD?** → Reference the existing concept app or prototype as the design source.

### 2. Ask Clarifying Questions

Before producing any code, ask targeted questions to resolve ambiguities. Focus on:

- **Layout**: Page structure, section hierarchy, content flow
- **Typography**: Heading scales, body text sizing, font preferences (if not specified)
- **Color palette**: Primary, secondary, accent colors, background tones
- **Spacing**: Density preference (airy vs. compact), margins, padding ratios
- **Responsive breakpoints**: Mobile-first or desktop-first, tablet considerations
- **Interactive states**: Hover, focus, active treatments
- **Edge cases**: Empty states, loading states, error states

Ask only what's necessary — skip questions where the PRD or existing app provides clear answers.

### 3. Implement

After receiving feedback, produce the frontend code:

**Stack:**

- HTML5 semantic markup
- Tailwind CSS (utility-first)
- Vanilla JS when interactivity is needed

**Output format:**

- Single HTML file with embedded styles and scripts
- Tailwind via CDN for portability

### 4. Iterate

Present the implementation. Await user feedback and refine as needed.

## Design Principles

### Typography

- Semi-bold weights for headings
- Clear hierarchy through size and weight contrast
- Avoid decorative or overly stylized fonts unless specified

### Visual Style

- Minimalist: purposeful use of space, no visual clutter
- Avoid excessive icons or emojis
- Avoid generic "AI look": no gradient blobs, no purple-on-white clichés, no cookie-cutter card layouts

### Responsive Design

- Mobile-first approach by default
- Fluid typography and spacing where appropriate
- Test mental model: phone → tablet → desktop

### Structure

- Semantic HTML elements (nav, main, section, article, aside, footer)
- Logical document outline
- Accessibility-conscious markup (proper heading order, alt text, aria labels where needed)

## Example Clarifying Questions

For a dashboard PRD:

> Before I start on the dashboard UI, a few quick questions:
>
> 1. The PRD mentions a sidebar — should it be collapsible on desktop, or fixed?
> 2. For the data cards, do you prefer a strict grid (e.g., 3 columns) or a masonry-style layout?
> 3. Any color preferences beyond what's in the PRD? I'm thinking neutral grays with a single accent color.

For an existing app iteration:

> Looking at the current app, I have some questions before refining:
>
> 1. The header feels heavy — would you like to explore a slimmer version?
> 2. The button styles vary across screens. Should I unify them?
> 3. Mobile nav isn't visible in the concept — hamburger menu or bottom tab bar?
