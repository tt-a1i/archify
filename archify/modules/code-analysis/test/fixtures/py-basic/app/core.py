import os
from app.util.text import clean
from ..sibling import x


def run():
    return clean(x, os.sep)
