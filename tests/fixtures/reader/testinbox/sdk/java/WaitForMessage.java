import email.testinbox.sdk.TestInbox;
import email.testinbox.sdk.model.Message;

TestInbox client = TestInbox.builder()
    .apiKey(System.getenv("TESTINBOX_API_KEY"))
    .build();

Message message = client.inboxes().waitForMessage(inbox.id(), wait -> wait
    .subject("Welcome")
    .timeout(Duration.ofSeconds(30)));
System.out.println(message.subject());
