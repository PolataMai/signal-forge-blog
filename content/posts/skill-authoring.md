---
title: Skill 创作手册：把经验封装成可复用工作流
excerpt: 从 SKILL.md 结构、触发语义到 scripts/assets 复用，拆解一份实用 skill 的写法和常见误区。
category: Skill 工坊
date: 2026-04-10
readingTime: 10 min
tags: skill, automation, codex
accent: lime
featured: true
---

## 先缩小 skill 的边界

很多人第一次写 skill，容易把它做成“万能助手说明书”。这样的问题是，skill 会变得很宽，触发条件含糊，真正使用时反而不知道该不该调用。

一个更稳妥的做法是，让 skill 只覆盖一个非常清楚的任务闭环。例如：

- “把 Figma 设计稿实现成前端代码”是一个 skill。
- “分析所有前端设计问题并提出各种建议”就太宽了。
- “部署 Azure OpenAI 模型并自动选容量最优区域”也是一个 skill。

边界越清晰，skill 的价值越高，因为它能让模型少做判断题，直接进入执行动作。

## 触发条件要具体

`SKILL.md` 最有价值的部分之一，是写清楚这份 skill 什么时候应该被用到。触发条件模糊，等于 skill 根本不存在。

```text
# deploy-model

Use for:
- deploy model
- create deployment
- best region for model
- capacity analysis

Do not use for:
- listing existing deployments
- deleting deployments
- general Azure deploy
```

这段信息看似简单，但它在实际协作里很关键。它告诉模型：这是一个“部署模型”的窄工作流，不要把无关问题也吸进来。

## 复用脚本和模板

如果 skill 目录里已经有 `scripts/`、`templates/`、`assets/`，应该优先复用，而不是在对话里重新打一遍大段内容。这样做能保持输出一致，也更容易迭代。

一份结构干净的 skill 往往会长这样：

```text
my-skill/
├── SKILL.md
├── scripts/
│   └── generate_report.sh
├── templates/
│   └── report-template.md
└── references/
    └── api-notes.md
```

然后在 `SKILL.md` 里只强调工作流，不去复制整份模板正文：

```text
1. Read only the relevant reference file.
2. Prefer using scripts/generate_report.sh.
3. Fill templates/report-template.md instead of drafting from scratch.
```

这样 skill 更像一个小型执行入口，而不是一坨静态知识堆积。

## 常见误区

下面几个问题出现频率很高：

- 描述太长，但没有“何时触发”与“不要用于什么”。
- 把多个工作流塞进同一个 skill，导致边界混乱。
- 明明有脚本和模板，却仍要求模型手写重复内容。
- 没有说明相对路径该如何解析，最终导致找不到资源。

> 最值得追求的 skill 特征不是“全面”，而是“能在正确时机把一个具体任务直接推进下去”。

当你把一份 skill 写到足够窄、足够清楚，它就会开始真正替你省时间。这也是个人知识资产从“笔记”升级到“工作流”的分界点。
