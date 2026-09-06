---
title: Troubleshooting
description: Common errors, what they mean, and the safe way to read raw message data.
---

## Errors

| Status | Meaning                                    | What to do                                   |
| ------ | ------------------------------------------ | -------------------------------------------- |
| `401`  | Missing or revoked credential              | Check the `X-Api-Key` header                 |
| `404`  | The inbox or message no longer exists      | Inboxes expire; see the inbox lifecycle      |
| `408`  | Wait timed out                             | Increase the timeout or check the matcher    |
| `409`  | The requested address is already in use    | Choose another `localPart`                   |
| `429`  | Rate limited                               | Retry after the `Retry-After` header         |

## Reading raw content safely

Message bodies are untrusted input. The API returns them as text, and so does this documentation: markup such as `<script>alert(1)</script>` or an `<img onerror>` attribute is data, never code. The same holds for entities like &lt;b&gt;bold&lt;/b&gt;, bidirectional controls such as "‮reversed", and zero-width characters ("zero​width").

```html title="Example body"
<p>Welcome! <a href="https://acme.dev/verify?token=…">Verify</a></p>
<script>alert("never executed by the reader")</script>
```

## Getting help

Write to [support@testinbox.email](mailto:support@testinbox.email) with the request id from the `X-Request-Id` header.
