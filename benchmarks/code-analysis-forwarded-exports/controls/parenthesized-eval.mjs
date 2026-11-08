export function work() { return 'before'; }
(eval)("work = () => 'after'");
