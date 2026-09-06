import email.testinbox.sdk.TestInbox;
import email.testinbox.sdk.model.Inbox;

TestInbox client = TestInbox.builder()
    .apiKey(System.getenv("TESTINBOX_API_KEY"))
    .build();

Inbox inbox = client.inboxes().create(new CreateInboxRequest()
    .ttl(3600)
    .name("signup"));
System.out.println(inbox.address());
