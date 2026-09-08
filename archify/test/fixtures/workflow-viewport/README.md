# Order workflow viewport regression

Original task (Chinese): 用户提交订单，校验并预占库存，创建待支付订单并等待支付；支付成功扣减库存并发货；库存不足提示失败；支付超时取消订单并释放预占库存；发货失败进入人工处理。

`order-overflow.workflow.json` is the final failed candidate from a Luna trial on
PR #325 (`d634028`), after three layout repairs. Static showcase validation
passed, but 1440×900 browser scrollHeight was 1499. This is a known failing
browser fixture, not a recommended authoring example.

`order-reflow.workflow.json` preserves its node business fields, edges, mainPath,
semanticChecks, cards, phases and metadata. Only lane grouping, columns and
vertical offsets differ. Both compile and deliver successfully. The browser
regression proves the overflow yields measured lane evidence and that a semantic
reflow can pass without weakening the gate. It blocks remote HTTP(S) resources
for repeatable font conditions; it does not establish online font reliability.

Rendered frame IDs are indices, not source ownership IDs. The diagnostic's
contained node boxes and blank-space measurements are observations, not proof
that headers, routing space, ownership boundaries or absolute pins can be moved.
The repaired layout is one valid answer to this task, not a universal repair.
