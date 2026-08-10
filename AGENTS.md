## Vision

The base model has no native vision capability. When the user shares an image (a local path, a URL, or a "Saved attachments:" block), do NOT use the Read tool on it. Instead run:

```
node vision.js "<图片路径>" "用中文描述这张图片"
```

For a network image URL:

```
node vision.js --url "<图片链接>" "用中文描述这张图片"
```

Config lives in `.env` (`DASHSCOPE_API_KEY`, `VISION_MODEL`). See `docs/agents/domain.md` for the domain layout.

## Agent skills

### Issue tracker

Issues are tracked as local Markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The default five-role triage label vocabulary is used. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses the single-context layout. See `docs/agents/domain.md`.
