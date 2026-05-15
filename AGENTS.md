# AGENTS.md

This repository is built around a Claude Code workflow. The `.claude/commands`
and `.claude/agents` directories are the primary orchestration layer and should
be preserved whenever possible.

## Codex Maintenance Rules

- Treat `.claude/commands` as the source of the intended blog workflow.
- Treat `.claude/agents` as role and review specifications that should be
  preserved or adapted with minimal structural change.
- Treat `scripts/` as Node-based helper tools that can also be run from Codex
  or a normal terminal.
- Keep the Naver blog preview and copy workflow in `scripts/preview.js`
  regression-free. The preview page must remain easy to use for copying title,
  metadata, body sections, and images into Naver Blog.
- Do not rewrite the project away from the Claude Code structure unless the user
  explicitly asks for that refactor.

## Image Generation

- The target image generation provider is OpenAI, with `gpt-image-2` as the
  default project goal.
- Image generation should save files under
  `output/<date>_<keyword>/images/`.
- API keys must be read from `.env` only.
- Never write real API keys in source code, documentation, examples, logs, or
  generated output.

## Git Hygiene

- Do not commit `.env`.
- Do not commit generated `output/` folders.
- Keep examples and documentation free of real secrets, private client data, and
  production credentials.

## Domain Rule Direction

The original repository contains hospital and medical-law-oriented examples and
review rules. For this project, those rules should be converted to detective
agency blog expression review rules.

## Detective Agency Prohibited Expressions

When writing or reviewing detective agency blog content, flag and remove
expressions that imply any of the following:

- Misleading language that could be mistaken for attorney or legal-service work
  in violation of attorney-law boundaries.
- Language that makes the agency look like a legal representative.
- Guarantees about litigation, winning lawsuits, settlements, or legal outcomes.
- Illegal location tracking or GPS tracking.
- Illegal lookup of personal information, resident registration data, addresses,
  employment records, financial records, or family records.
- Access to call logs, text messages, messenger records, carrier records, or
  other communications data without lawful authority.
- Hidden camera use, illegal filming, wiretapping, or secret recording.
- Hacking, account access, password recovery, device intrusion, spyware, or any
  other invasion of privacy.
- Exaggerated advertising such as "100% evidence secured", "we always catch
  them", "guaranteed result", or equivalent absolute claims.
- Fear-driven or sensational marketing that pressures the reader with excessive
  anxiety, shame, threat, or panic.

Prefer lawful, measured alternatives:

- "available investigation scope depends on law and case facts"
- "evidence collection is conducted within legal boundaries"
- "consultation can clarify what can and cannot be checked"
- "results cannot be guaranteed"
- "privacy-invasive or illegal requests are not accepted"

## Detective Agency Blog Writing Style

When generating or revising detective agency blog posts:

- Identify the search intent of the keyword before writing the body.
- Make the title and opening paragraph explicit and easy to understand.
- Put the core answer near the top instead of delaying it.
- Show the article structure quickly so readers know what will be covered.
- Keep paragraphs concise and avoid padding or repetitive explanation.
- Use concrete criteria, steps, and examples instead of vague phrases.
- Avoid ambiguous wording such as "may be helpful" when a specific lawful
  action, limit, or check can be stated.
- Maintain all prohibited-expression rules above, including no guarantees, no
  illegal tracking, no illegal personal-data lookup, and no privacy-invasive
  investigation claims.

## AI Briefing-Oriented Structure

Write posts so search engines and AI briefing features can extract a clear,
accurate answer from the page:

- Start each major section with a direct answer sentence before explanation.
- Use factual, self-contained paragraphs that can stand alone when summarized.
- Prefer concrete definitions, conditions, checklists, and comparison tables.
- Separate what can be checked, what cannot be checked, and what requires legal
  consultation.
- Avoid vague promotional copy that does not answer the search query.
- Do not overstate certainty; distinguish general guidance from case-dependent
  judgment.
- Keep image captions and surrounding text aligned with the actual section
  topic so extracted media is not misleading.
