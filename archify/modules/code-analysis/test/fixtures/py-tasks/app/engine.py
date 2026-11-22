"""Routes an incoming message to a handler."""


def route(message, user, flags):
    if not message:
        return None
    kind = message.get("kind")
    if kind == "text":
        if user.get("muted"):
            return "drop"
        if flags.get("translate") and message.get("lang") != user.get("lang"):
            return "translate"
        return "text"
    elif kind == "image":
        if message.get("size", 0) > 10_000_000:
            return "too-large"
        for tag in message.get("tags", []):
            if tag == "nsfw" and not user.get("adult"):
                return "blocked"
        return "image"
    elif kind == "command":
        name = message.get("name")
        if name == "help":
            return "help"
        elif name == "stop" or name == "quit":
            return "stop"
        elif name == "retry":
            while flags.get("busy"):
                flags["busy"] = False
            return "retry"
        return "unknown-command"
    elif kind == "event":
        try:
            code = int(message.get("code"))
        except (TypeError, ValueError):
            return "bad-event"
        return "event" if code > 0 else "noop"
    return "unsupported"


def describe(result):
    return result or "none"
