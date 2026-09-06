import { TestInbox } from "@testinbox/sdk";

const client = new TestInbox({ apiKey: process.env.TESTINBOX_API_KEY });

const inbox = await client.inboxes.create({
  ttl: 3600,
  name: "signup",
});
console.log(inbox.address);
