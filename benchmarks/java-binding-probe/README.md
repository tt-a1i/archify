# Java 调用绑定对照实验

这份固定实验比较 Archify 原有 JavaScript 调用事实、可选 JDK 语义增强，以及 JDK Compiler Tree API 在**同一份源码**上给出的声明绑定。产品仍以 JS 提取语法与 facts；启用 `java.semantic: true` 后，本机 JDK 只补充经源码范围和 Maven/source set 证据验证的调用目标。不接入 JDT LS，也不下载 jar。

## 固定输入与方法

- 真实输入：[Apache Commons Lang `5d2715b9da13fb584058d264c46dfed6bcc700d1`](https://github.com/apache/commons-lang/tree/5d2715b9da13fb584058d264c46dfed6bcc700d1) 的 `src/main/java`，264 个生产源码文件。该快照的 POM 使用 Java 8 source level；本次在 Temurin 25.0.5 上用 `--release 8 -proc:none` 对这 264 个文件解析和分析，编译诊断中没有错误。测试源码和外部 jar 未输入。
- 受控输入：[`fixture/`](fixture/) 中的双模块 Maven reactor，`app` 直接依赖 `api`，两份 Java 源码。它验证跨模块的静态调用、实例调用和工厂链；**合成 fixture 不代表真实多模块项目的覆盖率**。
- [`SourceBindings.java`](../../archify/modules/code-analysis/extract/java/SourceBindings.java) 通过 `JavacTask.parse()/analyze()` 和 `Trees.getElement()` 导出每个方法调用的源码范围、静态/实例种类与源码内声明位置。独立 oracle 把列出的全部源码一次交给 javac；它**不解析 POM，也不证明 Maven 模块可见性**。产品路径另按 Archify 捕获的 POM 将源码分组，向 JDK 传入临时源码快照，并在写入目标前核对构建可见性。
- [`compare.mjs`](compare.mjs) 按文件和四个位置坐标匹配两边调用，验证输入指纹、固定查询与目标，汇总源码内目标的已知/未解析数量。查询分别固定在 [`commons-queries.json`](commons-queries.json) 和 [`maven-queries.json`](maven-queries.json)；原 JS 结果在 [`results/commons.json`](results/commons.json)、[`results/maven.json`](results/maven.json)，可选增强结果在 [`results/commons-enhanced.json`](results/commons-enhanced.json)、[`results/maven-enhanced.json`](results/maven-enhanced.json)。结果文件只存汇总和代表性查询，原始 facts/TSV 可按下文重建。

## 结果

| 指标 | Commons Lang 原 JS | Commons Lang 增强 | 双模块原 JS | 双模块增强 |
| --- | ---: | ---: | ---: | ---: |
| 两边位置完全匹配的调用 | 9,922 | 9,922 | 4 | 4 |
| JDK 能指向输入源码的匹配调用 | 5,135 | 5,135 | 4 | 4 |
| Archify 已给目标 | 1,357 | **5,135** | 2 | **4** |
| 已给目标与 JDK 的文件/声明位置冲突 | 0 | 0 | 0 | 0 |
| JDK 有源码目标、Archify 保留未解析 | 3,778 | **0** | 2 | **0** |

Commons Lang 原有的 3,778 个未解析目标中，2,083 个是实例调用，1,695 个是静态调用；1,162 个跨文件，按源码目录计有 440 个跨包目录。原因分别为 `no-local-function-binding` 1,680、`unsupported-callee` 1,173、`ambiguous-binding` 925。增强路径新增 3,778 个目标，其中 238 个指向没有方法体的接口/抽象声明，作为独立的 `methodDeclarations` 导航证据记录，不混入函数复杂度指标。固定查询包括同文件静态正例、跨文件静态正例、重载、实例方法、接口方法、链式调用、JDK 外部方法等。

JDK 还记录了 127 个 Archify 调用 inventory 中没有的 `this()`/`super()` 构造器委托；这属于现有方法调用 inventory 的边界，未计入 3,778 个缺口。位置匹配只说明两个工具指向相同的调用表达式；上表的目标一致检查**文件、声明行与列**，没有验证运行时虚调用分派。

## Maven 依赖消融

从 fixture 的 `app/pom.xml` 删除对 `api` 的直接依赖后，独立 oracle 仍给出相同的 4 个目标，因为它一次分析全部源码、未读取 POM。原 JS 的 2 个普通类限定静态调用也仍给出目标；2 个实例调用继续未解析。可选增强路径在编译器不可分析 `app` 时保留 JS 调用 inventory，但撤销这 2 个缺少直接依赖的静态目标。这正是 [当前 v5 文档](../../archify/modules/code-analysis/docs/JAVA.md#method-invocation-source-navigation) 记录的旧全局候选边界，在增强模式下被收紧。更改 POM 后，[固定查询脚本](compare.mjs) 会因输入指纹变化拒绝旧结果，这是预期行为。

这项消融验证了增强实现的两个边界：JDK 只处理按捕获构建证据可见的源码组；即使编译失败，原有静态候选也不能越过 Maven 直接依赖限制。默认未启用增强时仍保留 v5 的原有事实契约。

## 耗时与边界

同一机器各运行三次的进程 wall time：JDK helper 2.21、3.22、2.37 秒；Archify `extractFacts` CLI 8.04、8.23、9.37 秒。两者工作量不同：JDK helper 只写调用绑定 TSV，Archify 同时产生文件、依赖、函数、项目元数据和完整 facts。因此这些数字**不能**推断改用 Java 后整条提取链更快。JDK helper 的预编译、JDK 下载与分发成本也未计时。

本次使用可由 JDK 8 标准库加源码独立编译的项目，以避免缺 jar 造成的假未解析。尚未验证外部 jar、完整 effective POM、Gradle、JPMS、生成源码、注解处理、Java 17/21/25 语法、JDT Core 绑定、跨平台分发或真实多模块项目。源文件被编译器绑定到的声明也不等于运行时动态分派的最终实现。

结论：可选 JDK 路径已补齐这份可独立编译的固定输入中的项目内方法目标，且没有改变原有正确目标。它仍受本机 JDK、目标语言版本、源码组可编译性和空外部 classpath 限制。下一轮应在真实多模块与有外部依赖的固定项目上，量化可用率、错误目标、整体耗时、版本及离线成本，再决定是否默认启用或扩展 classpath。

## 复跑

使用 Node 22.23.2 与 Temurin 25.0.5。先把固定 Commons Lang 提交检出到任意目录；脚本会核对源码指纹 `3c944bb4f3abc8821c41099c929c40780672bfa98cb276b9bb12d5456b419f81`。从 Archify 仓库根目录运行：

```sh
git clone --filter=blob:none https://github.com/apache/commons-lang.git /tmp/archify-binding-commons
git -C /tmp/archify-binding-commons checkout 5d2715b9da13fb584058d264c46dfed6bcc700d1
```

将 `JDK_HOME` 设为 Temurin 25.0.5 的 JDK 根目录，然后执行：

```sh
BENCH_DIR="$(pwd)/benchmarks/java-binding-probe"
COMMONS_ROOT=/tmp/archify-binding-commons
OUT_DIR="$(mktemp -d)"

"$JDK_HOME/bin/javac" -d "$OUT_DIR/classes" archify/modules/code-analysis/extract/java/SourceBindings.java
"$JDK_HOME/bin/java" -cp "$OUT_DIR/classes" SourceBindings "$COMMONS_ROOT" src/main/java "$OUT_DIR/commons.tsv" 8
(cd archify/modules/code-analysis && node test/run-extract.mjs "$COMMONS_ROOT/src/main/java" --language java --out "$OUT_DIR/commons-facts.json" --json)
node "$BENCH_DIR/compare.mjs" "$COMMONS_ROOT" "$OUT_DIR/commons-facts.json" "$OUT_DIR/commons.tsv" "$BENCH_DIR/commons-queries.json" > "$OUT_DIR/commons.json"
diff -u "$BENCH_DIR/results/commons.json" "$OUT_DIR/commons.json"

"$JDK_HOME/bin/java" -cp "$OUT_DIR/classes" SourceBindings "$BENCH_DIR/fixture" api/src/main/java,app/src/main/java "$OUT_DIR/maven.tsv" 8
(cd archify/modules/code-analysis && node test/run-extract.mjs "$BENCH_DIR/fixture" --language java --out "$OUT_DIR/maven-facts.json" --json)
node "$BENCH_DIR/compare.mjs" "$BENCH_DIR/fixture" "$OUT_DIR/maven-facts.json" "$OUT_DIR/maven.tsv" "$BENCH_DIR/maven-queries.json" > "$OUT_DIR/maven.json"
diff -u "$BENCH_DIR/results/maven.json" "$OUT_DIR/maven.json"

(cd archify/modules/code-analysis && ARCHIFY_JAVA="$JDK_HOME/bin/java" node test/run-extract.mjs "$COMMONS_ROOT/src/main/java" --language java --config "$BENCH_DIR/semantic-config.json" --out "$OUT_DIR/commons-enhanced-facts.json" --json)
node "$BENCH_DIR/compare.mjs" "$COMMONS_ROOT" "$OUT_DIR/commons-enhanced-facts.json" "$OUT_DIR/commons.tsv" "$BENCH_DIR/commons-queries.json" --enhanced > "$OUT_DIR/commons-enhanced.json"
diff -u "$BENCH_DIR/results/commons-enhanced.json" "$OUT_DIR/commons-enhanced.json"

(cd archify/modules/code-analysis && ARCHIFY_JAVA="$JDK_HOME/bin/java" node test/run-extract.mjs "$BENCH_DIR/fixture" --language java --config "$BENCH_DIR/semantic-config.json" --out "$OUT_DIR/maven-enhanced-facts.json" --json)
node "$BENCH_DIR/compare.mjs" "$BENCH_DIR/fixture" "$OUT_DIR/maven-enhanced-facts.json" "$OUT_DIR/maven.tsv" "$BENCH_DIR/maven-queries.json" --enhanced > "$OUT_DIR/maven-enhanced.json"
diff -u "$BENCH_DIR/results/maven-enhanced.json" "$OUT_DIR/maven-enhanced.json"
```

四个 `diff` 均无输出即与保存的固定结果一致。实验本身不需要 Maven 构建，也不会安装 live Archify。

在同一 shell 中可复跑依赖消融：复制 fixture，只删除 `app` 的直接依赖；独立 JDK TSV 与原 JS 调用目标保持不变，增强模式撤销两条缺少依赖证据的静态目标。这里用临时目录，不改动保存的固定输入。

```sh
cp -R "$BENCH_DIR/fixture" "$OUT_DIR/no-dependency"
python3 - "$OUT_DIR/no-dependency/app/pom.xml" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
text = p.read_text()
old = '  <dependencies>\n    <dependency><groupId>probe</groupId><artifactId>api</artifactId><version>1</version></dependency>\n  </dependencies>\n'
assert old in text
p.write_text(text.replace(old, ''))
PY
"$JDK_HOME/bin/java" -cp "$OUT_DIR/classes" SourceBindings "$OUT_DIR/no-dependency" api/src/main/java,app/src/main/java "$OUT_DIR/no-dependency.tsv" 8
cmp "$OUT_DIR/maven.tsv" "$OUT_DIR/no-dependency.tsv"
(cd archify/modules/code-analysis && node test/run-extract.mjs "$OUT_DIR/no-dependency" --language java --out "$OUT_DIR/no-dependency-facts.json" --json)
node - "$OUT_DIR/maven-facts.json" "$OUT_DIR/no-dependency-facts.json" <<'JS'
const fs = require('node:fs');
const calls = file => JSON.parse(fs.readFileSync(file, 'utf8')).calls.map(call => [call.resolution, call.target?.file || null, call.target?.line || null]);
const before = calls(process.argv[2]);
const after = calls(process.argv[3]);
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('call results changed');
console.log(after);
JS
(cd archify/modules/code-analysis && ARCHIFY_JAVA="$JDK_HOME/bin/java" node test/run-extract.mjs "$OUT_DIR/no-dependency" --language java --config "$BENCH_DIR/semantic-config.json" --out "$OUT_DIR/no-dependency-enhanced-facts.json" --json)
node - "$OUT_DIR/no-dependency-enhanced-facts.json" <<'JS'
const fs = require('node:fs');
const facts = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (facts.calls.some(call => call.target)) throw new Error('undeclared Maven target survived');
console.log(facts.languageScope.semantic);
JS
```
