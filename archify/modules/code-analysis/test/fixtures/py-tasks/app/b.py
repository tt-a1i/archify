"""Request handler that reads its limits from the config."""
from app.a import DEFAULT_TIMEOUT


class Handler:
    def __init__(self, config):
        self.config = config

    def limit(self):
        return self.config.timeout or DEFAULT_TIMEOUT
