# 已经有值，默认函数为什么还会执行？ {#option-default}

即使已有 `Some(7)`，`unwrap_or` 的默认值参数也会先求值。想等到 `None` 时才调用默认函数，就把调用写进 `unwrap_or_else` 的闭包体。[](source:option)

@answer scope="Rust 1.89.0 · 本地调用记录，未测耗时"
@meta locale=zh-CN style=editorial
@source option title="Rust 1.89.0：默认值与闭包的处理" url=https://github.com/rust-lang/rust/blob/29483883eed69d5fb4db01964cdf2af4d86e9cb2/library/core/src/option.rs#L1009-L1052

## 返回同一个值，执行过程也一样吗？ {#observation}

下面的默认函数 `fallback()` 每次记录一次调用，并返回 `99`。本地探针分别运行两种写法，得到这些结果：

| 输入 | 调用次数与返回值 |
| --- | --- |
| `Some(7)` | `unwrap_or` 调用 1 次，`unwrap_or_else` 调用 0 次；两者都返回 `7`。 |
| `None` | 两种写法都调用 1 次，返回 `99`。 |
| `Some(0)` | `unwrap_or` 调用 1 次，`unwrap_or_else` 调用 0 次；两者都返回 `0`。 |

`Some(0)` 也是有值；`None` 才表示缺值。这里记录的是调用，不是速度。

## 复制运行，就能看到区别 {#example}

这是独立可运行的示例程序，默认函数只打印一行文字，不读文件，也不请求网络。

```rust title="示例程序：两种写法都返回 7"
fn fallback() -> i32 {
    println!("fallback called");
    99
}
fn main() {
    let value = Some(7);
    let eager = value.unwrap_or(fallback());
    println!("unwrap_or: {eager}");
    let lazy = value
        .unwrap_or_else(|| fallback());
    println!("unwrap_or_else: {lazy}");
}
```

```text title="本机运行输出"
fallback called
unwrap_or: 7
unwrap_or_else: 7
```

两次都返回了 `7`，但默认函数只在第一种写法中执行。

## 方法收到的是值，还是一段待执行的代码？ {#mechanism}

`unwrap_or` 接收默认值本身，所以参数里的 `fallback()` 在进入方法前就要执行。

`unwrap_or_else` 接收闭包，相当于把“需要时再调用”的动作传进去。源码只在 `None` 分支调用它；遇到 `Some(x)` 就直接返回 `x`。[](source:option)

## 提前算好，再放进闭包，有用吗？ {#boundary}

下面是写法示意，需要上下文中的 `value`。第一行已经调用了默认函数，第二行无法撤销它：

```rust title="反例：计算发生在闭包外"
let ready = fallback();
let result = value
    .unwrap_or_else(|| ready);
```

要延后这次调用，应把 `fallback()` 放进闭包体，像上面的完整程序一样。延迟的是闭包体的执行，不能替你推迟前面已经完成的计算。

如果默认值本来就已准备好，例如 `value.unwrap_or(0)`，直接传值就合适。无需一律改成闭包。
