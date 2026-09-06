---
title: Inbox lifecycle
description: How inboxes are created, receive mail, expire, and are deleted.
---

An inbox moves through three states.

![Inbox lifecycle: created, active, expired](../images/inbox-lifecycle.png)

## Created

[Create inbox](/api/inboxes/create-inbox) returns an address immediately. The inbox starts with an empty message list and a `ttl` in seconds (default 3600, maximum 86400).

## Active

While active, the inbox accepts every message sent to its address. Messages are parsed on arrival; see [Get message](/api/messages/get-message) for the parsed shape, including the `content` variants.

## Expired

When the `ttl` elapses the inbox stops receiving mail but stays readable for 24 hours, so a slow CI job can still inspect what arrived. After that it is deleted, together with its messages and attachments.

> Expiry is measured from creation, not from the last message. Extend the `ttl` with [Update inbox](/api/inboxes/update-inbox) if a test needs more time.

## Tags

Tags are free-form labels (at most 10 per inbox) used by [List inboxes](/api/inboxes/list-inboxes) filters and by webhook filters. Choose stable tags such as `signup-flow` rather than per-run identifiers.
