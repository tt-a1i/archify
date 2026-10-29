# 图例移到底部，数值为什么不见了？ {#pie-legend}

旧版只为以 `pie` 开头的源码补全图例。布局配置写在前面后，这一步就被跳过了。修复后先解析配置和数据，再补上数值与占比，图例也能保留在底部。[](source:before)[](source:after)

@answer scope="Archify explainer · 此例总数为 21"
@meta locale=zh-CN style=editorial
@source before title="修复前：先检查源码开头" url=https://github.com/tt-a1i/archify/blob/87747b86e145c03ab3aca7a559f4759a48913302/archify/explainer/charts.mjs
@source after title="修复后：先解析，再补全图例" url=https://github.com/tt-a1i/archify/blob/e5e03d185ce0617aa4fc7645bac0317e4079f421/archify/explainer/charts.mjs
@source change title="完整代码修改" url=https://github.com/tt-a1i/archify/commit/e5e03d185ce0617aa4fc7645bac0317e4079f421

## 同一份数据，图例有什么变化？ {#example span=8}

例子用前置配置把图例放到底部，三个值是 A=10、B=3、C=8。总数为 21，占比四舍五入到整数；例如 A 的占比约为 48%。

| 旧版图例 | 修复后图例 |
| --- | --- |
| A | A · 10 (48%) |
| B | B · 3 (14%) |
| C | C · 8 (38%) |

## 为什么改位置会影响内容？ {#cause span=6}

旧版先改写源码里的标签，再交给解析器。但它只检查源码是否以 `pie` 开头，前面一旦有注释、前置配置或初始化配置，就跳过标签改写。饼图仍能画出来，图例却只有类别名。[](source:before)

图例的位置没有决定数值是否显示。问题出在处理顺序：配置还没被解析，图例补全就已被跳过。

## 修复后，数据和配置一起保留 {#order span=6}

@steps
| parse | 先解析输入 | 识别为饼图后，解析器读取配置和数据，得到同一份解析结果。 |
| decorate | 再补全图例 | 用解析器接受的扇区数据计算总数和占比，补到类别名后面。 |
| render | 按原配置绘图 | 使用这份已补全图例的解析结果绘图；底部布局继续生效。 |

旧式多行输入的兼容处理仍在：对以 `pie` 开头的输入，解析前整理空白并保留换行。这不意味着任何格式错误都能被接受；其他图表类型沿用原来的处理路径。[](source:after)

[查看完整代码修改](source:change)
