"""Order model."""


class Order:
    def __init__(self, items):
        self.items = list(items)

    def total(self):
        return sum(item["price"] for item in self.items)
