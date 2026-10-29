# 为什么加了配置前缀，饼图图例仍能显示数值？ {#pie-legend}

以前，在饼图前加布局配置后，图例只显示类别；修复后，同一图例也显示数值和占比。原因是编译器先解析饼图，再修饰解析结果，而不再依赖源码以 `pie` 开头。[](source:before)[](source:after)

@answer scope="Archify explainer 编译器 · 支持的饼图输入"
@meta locale=zh-CN
@source before title="修复前的图表编译器" url=https://github.com/tt-a1i/archify/blob/87747b86e145c03ab3aca7a559f4759a48913302/archify/explainer/charts.mjs
@source after title="修复后的图表编译器" url=https://github.com/tt-a1i/archify/blob/e5e03d185ce0617aa4fc7645bac0317e4079f421/archify/explainer/charts.mjs
@source change title="完整修改" url=https://github.com/tt-a1i/archify/commit/e5e03d185ce0617aa4fc7645bac0317e4079f421

## 同一份配置，图例有什么变化？ {#example}

示例在 YAML 前置配置中设置 `config.pie.legendPosition=bottom`，数据是 A=10、B=3、C=8。总数是 21；占比按各值除以 21 后四舍五入。

| 类别 | 修复前 | 修复后 |
| --- | --- | --- |
| A | A | A · 10 (48%) |
| B | B | B · 3 (14%) |
| C | C | C · 8 (38%) |

## 前缀为什么曾经影响图例？ {#cause}

旧编译器在解析前改写原文，只有开头是 `pie` 的文本才进入图例修饰。前面有注释、前置配置或初始化配置时，这一步被跳过；饼图仍可解析，图例却缺少数值和占比。[](source:before)

## 修复后按什么顺序处理？ {#order}

@steps
| detect | 识别类型 | 先识别是否为饼图。 |
| normalize | 保留旧输入 | 对以 `pie` 开头的旧式多行写法整理空白，保留换行。 |
| parse | 解析饼图 | 解析器接收输入，得到包含配置和已接受扇区的模型。 |
| decorate | 修饰模型 | 用模型中已接受的数值计算总数和占比，再改写图例标签。 |
| render | 渲染同一模型 | 渲染修饰后的模型，保留已解析的配置。 |

配置前缀不再决定图例是否被修饰。空白整理仍为兼容旧式多行写法而保留；这不表示所有格式错误的输入都能解析。非饼图仍走原有路径。[](source:after)

[查看完整修改](source:change)
