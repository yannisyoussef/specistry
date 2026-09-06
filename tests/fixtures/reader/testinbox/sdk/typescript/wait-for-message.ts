import { TestInbox } from "@testinbox/sdk";

const client = new TestInbox({ apiKey: process.env.TESTINBOX_API_KEY });

const message = await client.inboxes.waitForMessage(inbox.id, {
  subject: /Welcome/,
  timeout: 30_000,
});
console.log(message.subject);
