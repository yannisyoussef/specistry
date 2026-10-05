---
title: Introduction
description: What TestInbox is, what it is not, and how the pieces fit together.
---

TestInbox gives every automated test a **disposable inbox** with a real address. Your application sends email exactly as it does in production; your test reads the message back through the API and asserts on it.

## What you get

- Inboxes that expire on their own (`ttl`), so sandboxes stay clean.
- Messages parsed into text, HTML, links, headers, and attachments.
- Webhooks for event-driven pipelines instead of polling.
- Verified domains when you need readable addresses.

## What it is not

TestInbox is not a mail server for production traffic and it never relays mail outward. Sandbox mail never leaves the sandbox.

## Next steps

Read the [Quickstart](./quickstart), then the [inbox lifecycle](./concepts/inbox-lifecycle) to understand expiry, or jump straight to the [API reference](/api).
