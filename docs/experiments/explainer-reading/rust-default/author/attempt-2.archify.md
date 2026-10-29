# 返回了 7，为什么 fallback 还是执行了？ {#option-default}

`Some(7).unwrap_or(fallback())` 返回 `7`，但 `fallback()` 已经执行。因为调用 `unwrap_or` 前，Rust 要先算出它的默认值参数。[](source:option)

- `unwrap_or_else(|| fallback())` 把调用放进闭包；只有 `None` 分支才调用闭包。[](source:option)
- 已经提前算出的默认值，不会因为放进闭包就撤销计算。

@answer scope="Rust 1.89.0 · Option 默认值求值"
@meta locale=zh-CN style=editorial
@source option title="Rust 1.89.0 Option 源码，第 1009–1052 行" url=https://github.com/rust-lang/rust/blob/29483883eed69d5fb4db01964cdf2af4d86e9cb2/library/core/src/option.rs#L1009-L1052

## 相同返回值，不同执行过程 {#observation}

下面的示意假设 `fallback()` 记录一次事件并返回 `99`。事件表示调用发生，不表示耗时。

| 输入 | 写法 | 返回 | `fallback()` |
| --- | --- | --- | --- |
| `Some(7)` {#some-eager} | `unwrap_or(fallback()) | `7` | 执行 |
| `Some(7)` {#some-lazy} | `unwrap_or_else(|| fallback()) | `7` | 不执行 |
| `None` {#none-eager} | `unwrap_or(fallback()) | `99` | 执行 |
| `None` {#none-lazy} | `unwrap_or_else(|| fallback()) | `99` | 执行 |
| `Some(0)` | `unwrap_or_else(|| fallback())` | `0` | 不执行 |

`Some(0)` 仍然有值；`None` 才表示没有值。以上结果与本地 Rust 1.89.0 的九种组合探针一致；探针记录的是事件顺序，不是性能测量。[](source:option)

## 两个方法各收到什么？ {#mechanism}

| 写法 | 方法收到 | 遇到 `Some(x)` | 遇到 `None` |
| --- | --- | --- | --- |
| `unwrap_or(fallback())` | 已求出的默认值 | 返回 `x` | 返回默认值 |
| `unwrap_or_else(|| fallback())` | 一个闭包 | 返回 `x` | 调用闭包并返回结果 |

源码中，`unwrap_or` 的参数是 `default: T`，而 `unwrap_or_else` 接收 `FnOnce() -> T`。后者只在 `None` 分支调用 `f()`。[](source:option)

## 闭包里拿到的值，何时算出来？ {#boundary}

以下是写法示意，`fallback` 在第一行就执行了：

```rust
let ready = fallback();
let result = value.unwrap_or_else(|| ready);
```

把计算移到闭包体内，才会让这次调用等到 `None`：`value.unwrap_or_else(|| fallback())`。这里的延迟只指闭包体的调用；创建闭包及捕获表达式可能有各自的求值效果。

如果默认值已经可用，例如 `value.unwrap_or(0)`，直接传值也很合理。选择取决于是否需要在缺值时才执行那段计算。
