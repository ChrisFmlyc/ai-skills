# ai-skills

Personal Claude Code marketplace for managing and deploying skills across work and personal environments.

This repository is a [Claude Code plugin marketplace](https://docs.claude.com/en/docs/claude-code/plugins) — it bundles plugins (collections of skills, agents, commands, and hooks) so they can be installed in any Claude Code environment with a single command.

## Structure

```
ai-skills/
├── .claude-plugin/
│   └── marketplace.json        # marketplace manifest
├── plugins/
│   └── <plugin-name>/
│       ├── .claude-plugin/
│       │   └── plugin.json     # plugin manifest
│       ├── README.md
│       └── skills/
│           └── <skill-name>/
│               └── SKILL.md    # skill with frontmatter
└── README.md
```

Each plugin lives under `plugins/<plugin-name>/` and follows the [skill-creator](https://github.com/anthropics/skills) layout. Skills are picked up from `skills/<skill-name>/SKILL.md` and exposed as slash commands of the form `/<plugin>:<skill>`.

## Plugins

| Plugin | Description |
|--------|-------------|
| [`crx`](./plugins/crx) | Personal CodeRabbit helpers — single and batched finding fix flows. |

## Install

Add this marketplace once:

```
/plugin marketplace add ChrisFmlyc/ai-skills
```

Then install any plugin from it:

```
/plugin install crx@ai-skills
```

Restart Claude Code so new slash commands register.

## Update

Pull the latest marketplace state, then update an installed plugin:

```
/plugin marketplace update ai-skills
/plugin update crx@ai-skills
```

## Uninstall

```
/plugin uninstall crx@ai-skills
/plugin marketplace remove ai-skills
```

## Authoring new plugins

1. Create `plugins/<name>/.claude-plugin/plugin.json` with `name`, `description`, `version`, `author`.
2. Add skills under `plugins/<name>/skills/<skill-name>/SKILL.md`. Each `SKILL.md` needs YAML frontmatter with `name` and `description`. The `description` is what Claude matches against to decide when to trigger the skill — make it specific.
3. Register the plugin in `.claude-plugin/marketplace.json` under `plugins`.
4. Bump `version` in `plugin.json` whenever you publish a change.

Refer to the existing `crx` plugin as a template.

## License

Personal use. No warranty.
