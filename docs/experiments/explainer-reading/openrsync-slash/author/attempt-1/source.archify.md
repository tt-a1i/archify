# 源目录末尾的 `/`，差哪一层？ {#slash}

在这个 Apple openrsync 实例中，`src` 把目录本身放进 `dst`；`src/` 把目录里的内容放进 `dst`。两种写法都递归复制子目录。[](source:manual)

@answer scope="单个源目录 · 本地复制 · 空目标目录"
@meta locale=zh-CN style=editorial
@source manual title="Apple openrsync 手册：递归与源目录末尾斜杠" url=https://github.com/apple-oss-distributions/rsync/blob/13eacd7e9a204b236310dab23682f6354ecc69bd/openrsync/openrsync.1#L760-L773
@source destination title="Apple openrsync 手册：目标目录" url=https://github.com/apple-oss-distributions/rsync/blob/13eacd7e9a204b236310dab23682f6354ecc69bd/openrsync/openrsync.1#L972-L981
@source probe title="本地探测记录：probe-1.json" path=../source/probe-1.json

## 相同的源目录 {#source}

下面的源目录含一个嵌套文件和一个隐藏文件。两次命令分别使用已有的空 `dst`。这是本地探测中的目录结构。[](source:probe)

```text title="源目录"
src/
├── .hidden
├── a.txt
└── nested/
    └── b.txt
```

## 目标目录里有什么？ {#results}

```sh title="不带斜杠"
rsync -r -- src dst
```

```text title="实测结果：dst 下多一层 src"
dst/
└── src/
    ├── .hidden
    ├── a.txt
    └── nested/
        └── b.txt
```

```sh title="带斜杠"
rsync -r -- src/ dst
```

```text title="实测结果：内容直接放在 dst 下"
dst/
├── .hidden
├── a.txt
└── nested/
    └── b.txt
```

两次命令均以状态码 `0` 退出，源文件仍在。[](source:probe)

## 为什么子目录还在？ {#why}

`-r` 递归处理整个子树。源路径末尾的 `/` 只改变源目录这一层是否进入目标，不会关闭递归。[](source:manual) 两个结果都包含 `nested/b.txt` 和 `.hidden`。[](source:probe)

## 这个结果适用于哪里？ {#scope}

探测使用 macOS 的 `/usr/bin/rsync`，其标识为 openrsync，项目为 `rsync-184`。匹配的 Apple 源码固定在提交 `13eacd7e9a204b236310dab23682f6354ecc69bd`；这不是逐字节构建验证。兼容版本标识也不能证明它是上游 rsync 二进制文件。[](source:probe)

本例只涉及本地单源目录和 `-r`。目标不存在时，手册说会创建目标目录；本次探测得到相同的两种目录层级。[](source:destination)[](source:probe) 这里没有验证过滤、符号链接、远程传输或元数据。
