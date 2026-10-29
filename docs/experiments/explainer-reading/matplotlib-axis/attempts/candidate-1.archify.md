# 同样的 80 和 100，为什么柱长比例变了？ {#axis-view}

A 是 80，B 是 100；数据没有变化。纵轴从 70 开始后，图中只露出柱子的上面一截，不能用这段长度之比代替数据之比。[](source:probe)

- B 与 A 的数值比是 `100 / 80 = 1.25`，B 比 A 大 25%。
- 截断视图中，可见部分分别是 10 和 30，长度比是 3。[](source:probe)

@answer span=12 scope="Matplotlib 3.11.2 · 合成的无单位数值 · 正值线性柱状图"
@meta locale=zh-CN
@source probe title="两次绘图的数值、视图和渲染几何" path=source/probe-1.json
@source ylim title="Matplotlib set_ylim 源码" url=https://github.com/matplotlib/matplotlib/blob/d3ca9172e392048ec242b90e8423e88d1a3000b2/lib/matplotlib/axes/_base.py#L4165
@source bar title="Matplotlib bar 源码" url=https://github.com/matplotlib/matplotlib/blob/d3ca9172e392048ec242b90e8423e88d1a3000b2/lib/matplotlib/axes/_axes.py#L2307

## 从零开始：完整柱长 {#zero span=6}

@image path=images/zero.png alt="纵轴从零开始，A 为 80，B 为 100 的 Matplotlib 柱状图" caption="纵轴显示范围：0 到 110"

A、B 是两个类别的名称，图上的 Value 意为“数值”。这两个数字是合成示例，没有单位。柱子从 0 开始，可见长度分别对应 80 和 100。[](source:probe)

## 从 70 开始：只看上段 {#cropped span=6}

@image path=images/cropped.png alt="纵轴从 70 开始，A 为 80，B 为 100 的 Matplotlib 柱状图" caption="纵轴显示范围：70 到 110"

柱子的底部仍是 0，但 70 以下在显示范围之外。A 留下 `80 − 70 = 10`，B 留下 `100 − 70 = 30`。[](source:probe)

## 哪个比值回答了什么？ {#ratios span=6}

| 要比较的东西 | B / A |
| --- | --- |
| 原始数值 | `100 / 80 = 1.25` |
| 从 70 开始露出的柱段 | `30 / 10 = 3` |

两数相差 `100 − 80 = 20`；以 A 为基准，差值是 `20 / 80 = 25%`。可见长度比描述的是被裁切后的图形，不是原始数据比。[](source:probe)

## 改变的是什么？ {#mechanism span=6}

两张图的柱子底部都是 0，高度仍是 80 和 100。`set_ylim` 改变纵轴的显示范围，不改变这些柱子属性。[](source:bar)[](source:ylim)

在这个正值线性柱状图中，显示零点便于把完整柱长与数值对应。局部范围可以帮助查看细节，但应把可见柱段和完整数值分开读。这是对本例的解读，不是所有图表都必须从零开始的规则。
