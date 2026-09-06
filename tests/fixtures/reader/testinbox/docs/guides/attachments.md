---
title: Attachments
description: Listing and downloading attachments, and the limits that apply.
---

Attachments are parsed when a message arrives and listed on the [message](/api/messages/get-message).

## Listing

[List attachments](/api/attachments/list-attachments) returns metadata only: file name, content type, and size.

## Downloading

[Download attachment](/api/attachments/download-attachment) streams the bytes with the original `Content-Type`. Pass `disposition=attachment` to force a download header.

```bash
curl -H "X-Api-Key: $TESTINBOX_API_KEY" \
  "https://api.testinbox.email/v1/attachments/att_01J7QA" -o invoice.pdf
```

## Limits

- Messages larger than 25 MB are rejected by the sandbox.
- Attachments are kept as long as their message.
- Inline images referenced by the HTML body appear as attachments with a `contentId`.
