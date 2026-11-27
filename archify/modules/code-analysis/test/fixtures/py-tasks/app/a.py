"""Settings shared by the request handlers."""
from app.b import Handler

DEFAULT_TIMEOUT = 30


class Config:
    def __init__(self, timeout=DEFAULT_TIMEOUT):
        self.timeout = timeout
        self.handler = Handler(self)
