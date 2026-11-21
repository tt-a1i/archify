"""Order checkout."""
from domain.model import Order
from ui.view import format_price


def checkout(items):
    order = Order(items)
    return format_price(order.total())
