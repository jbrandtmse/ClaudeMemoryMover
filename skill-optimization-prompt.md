I need you to update the model configuration for all BMAD Method skills to optimize for an InterSystems ObjectScript stack. We want to balance token costs against the need for high accuracy on an uncommon codebase.

Please scan the `.claude/skills/` directory (where the BMAD skills are installed) and modify the YAML frontmatter of the `SKILL.md` (or `.md`) files. Specifically, add or update the `model:` attribute for each skill according to these exact rules:

1. **Set `model: opus` (or the `opus` alias) for these critical Architecture, QA, and Context-fusion skills:**
   - bmad-create-architecture
   - bmad-create-story
   - bmad-code-review
   - *Rule:* Any custom skill you find that is explicitly responsible for adversarial code review, system architecture, or massive context-file assembly must also be set to `opus`.

2. **Set `model: sonnet` (or the `sonnet` alias) for these Implementation and Planning skills:**
   - bmad-brainstorming
   - bmad-domain-research
   - bmad-market-research
   - bmad-technical-research
   - bmad-product-brief
   - bmad-prfaq
   - bmad-create-prd
   - bmad-create-ux-design
   - bmad-create-epics-and-stories
   - bmad-check-implementation-readiness
   - bmad-dev-story
   - bmad-correct-course
   - bmad-retrospective
   - bmad-quick-dev
   - bmad-party-mode
   - bmad-generate-project-context
   - *Rule:* Any custom skill you find that writes code implementations, generates documentation, or creates sprint tickets must also be set to `sonnet`.

3. **Set `model: haiku` (or the `haiku` alias) for these Administrative and Mechanical skills:**
   - bmad-sprint-planning
   - bmad-sprint-status
   - bmad-help
   - *Rule:* Any custom skill you find that only reads logs, checks workflow status, updates YAML trackers, or routes intents must also be set to `haiku`.

If you find a skill that isn't explicitly listed here, use the generic rules provided to categorize it into Opus (QA/Architecture), Sonnet (Coding/Docs), or Haiku (Admin/Status) and update it accordingly. 

Please read the files, apply the updates, and provide a brief summary of the files you modified.