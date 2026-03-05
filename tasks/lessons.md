# Antigravity Project Lessons

## Bug: Skill Guidelines Not Being Triggered

- **Correction Date:** 2026-03-05
- **Context:** The user created an impressive `SKILL.md` file meant to dictate the core agenting behavior on the project, but by default, the AI skips it as being non-relevant to standard "coding" requests.
- **Mistake Pattern:** Failing to realize that the user wants to globally impose behavioral rules via that `SKILL.md` file. The tool allows specific `Skill` files, but the AI won't read them autonomously unless the description literally forces it.
- **New Rule:** Always ensure that fundamental agenting workflows, error tracking logs (`tasks/lessons.md` and `tasks/todo.md`), and custom instructions explicitly request "Apply the agent plan and verification methodology." Further, we solve this permanently by injecting the `.cursorrules` directly and modifying the `SKILL.md` frontmatter description.
