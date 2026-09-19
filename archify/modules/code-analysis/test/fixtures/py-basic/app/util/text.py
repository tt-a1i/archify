import requests
import importlib
from . import missing
from .nothere import z


def clean(value, sep):
    from app import core as lazy_core
    importlib.import_module("app.core")
    importlib.import_module(value)
    return value
