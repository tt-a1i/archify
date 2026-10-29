# 源目录末尾的 `/`，差哪一层？ {#slash}

目标目录 `dst` 已存在且为空时，`src` 会把自己那一层也复制进去，得到 `dst/src/`；`src/` 则把内容直接放进 `dst/`。两者都会复制子目录。[](source:manual)

@answer scope="Apple openrsync · 本地 -r 复制 · 空目标目录"
@meta locale=zh-CN style=editorial
@source manual title="Apple openrsync 手册：递归与源目录末尾斜杠" url=https://github.com/apple-oss-distributions/rsync/blob/13eacd7e9a204b236310dab23682f6354ecc69bd/openrsync/openrsync.1#L760-L773
@source destination title="Apple openrsync 手册：目标目录" url=https://github.com/apple-oss-distributions/rsync/blob/13eacd7e9a204b236310dab23682f6354ecc69bd/openrsync/openrsync.1#L972-L981
@source probe title="本地目录与文件内容记录" path=source/probe-1.json

## 从相同的源目录开始 {#source span=6}

两个例子分开运行，每次都使用这三份源文件和一个空 `dst`。[](source:probe)

```text title="复制前的文件路径"
src/.hidden
src/a.txt
src/nested/b.txt
```

## 不带 `/`：保留外层 src {#without-slash span=6}

```sh title="复制源目录本身"
rsync -r -- src dst
```

```text title="复制后的目标目录"
dst/
└── src/
    ├── .hidden
    ├── a.txt
    └── nested/
        └── b.txt
```

`src` 这一层进入了 `dst`；嵌套文件位于 `dst/src/nested/b.txt`。[](source:probe)

## 带 `/`：内容直接进入 dst {#with-slash span=6}

```sh title="复制源目录里的内容"
rsync -r -- src/ dst
```

```text title="复制后的目标目录"
dst/
├── .hidden
├── a.txt
└── nested/
    └── b.txt
```

`-r` 仍然递归复制，嵌套文件位于 `dst/nested/b.txt`。末尾的 `/` 没有关闭递归，隐藏文件也仍在。[](source:manual)[](source:probe)

## 这次实测的范围 {#scope span=12}

使用 macOS 的 Apple openrsync（项目 `rsync-184`）做本地复制。两次命令都成功退出，源文件保持不变。目标目录不存在时，手册说明会创建它；本次探针也得到相同的两种目录层级。[](source:destination)[](source:probe)

结果针对单个源目录和 `-r`；过滤规则、符号链接、远程传输和元数据不在这次检查范围内。
