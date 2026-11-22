"""Formatting helpers for the order screen."""
from domain.model import Order


def format_price(value):
    return f"${value:,.2f}"


def render(items):
    return format_price(Order(items).total())
