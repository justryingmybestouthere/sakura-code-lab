# Sakura Code Lab

A browser-based IDE foundation inspired by traditional Japanese design philosophies. This repository contains a working frontend shell, editor layout, file explorer, persistence layer, and Sakura-inspired visual system.

## What is included

- React + TypeScript + Vite application shell
- Monaco editor integration for code editing
- Explorer and tabbed workspace layout
- Autosave with browser local storage persistence
- Sakura-inspired design language with warm pinks, ink black, plum, gold, and paper textures
- AI panel and bottom panel mockups for IDE workflow

## Getting started

```bash
npm install
npm run dev
```

Then open the local Vite URL in your browser.

## Architecture direction

This repository is intentionally structured as a strong Phase 1–2 foundation for the full product specification:

- Application shell and desktop IDE layout
- File management and workspace flows
- Code editing experience
- Persistence and refresh safety
- Sakura visual identity and cultural references

## Notes

- The app currently runs fully on the browser side with local persistence.
- Sandbox execution and AI integration are structured as future service boundaries rather than fake UI-only placeholders.
- The design takes inspiration from geisha culture, washi paper, kimono motifs, Shibui palettes, wabi-sabi balance, and traditional Japanese screen geometry without copying any specific proprietary product branding.

## Planned next phases

1. Real execution sandbox and terminal orchestration
2. Diagnostic engine and test runner abstraction
3. User-authored project persistence with IndexedDB
4. AI assistant context pipeline
5. Research and fact-check workflow
6. Hardening, accessibility, and security review
