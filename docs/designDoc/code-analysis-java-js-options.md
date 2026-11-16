# Java 源码提取：JS 开源方案与所需语义

调查基线：`origin/labs/code-analysis` 的 `197980b7`（2026-11-12）；实验日期：2026-11-13，JDK 绑定对照更新于 2026-11-16。当前修复已迁移到 Labs `457d71b9`（2026-11-15）。此文记录 Java 源码分析的库选型，不把编辑器语言服务的能力清单当作 Archify 的功能清单。默认产品仍用 `java-parser@3.0.1` 的 JavaScript CST 提取器；现有可选 JDK 绑定只补充已捕获源码的方法目标，JDT LS 的运行时接入实验已从本工作树移除。

## 先看产品实际需要什么

| Archify 所需结果 | 当前来源和缺口 | JS 库能直接提供什么 |
| --- | --- | --- |
| 源文件、声明、准确源码范围、函数复杂度 | `parse.mjs` 和 `functions.mjs` 已实现；`java-parser` 对空 record 有一处受控修正，Unicode escape 有明确拒绝边界。 | 语法树和 token 位置；复杂度规则仍由 Archify 定义。 |
| import 与类型依赖 | `imports.mjs` 用已捕获源码建立保守索引；外部类路径、通配 import、生成源码不能可靠归属。 | 解析 import/type 的语法形状；没有候选库声明提供完整项目类型绑定。 |
| 调用点与可导航目标 | `calls.mjs` 保留全部可解析方法调用点，只在唯一静态源码候选、限定继承和构建证据下给目标。重载参数类型、动态分派、方法引用等仍未知。 | 解析调用语法；跨文件语义仍需独立证据。 |
| Maven 源码可见性 | `projects.mjs` 只读捕获的 POM、父 POM、默认属性和直接依赖；不执行 Maven、profile 或插件。 | XML 解析器提供节点；effective POM、编译 source set 与依赖优先级不是普通 XML 解析功能。 |

这也限定了借鉴 [Go PR #1347](https://github.com/tt-a1i/archify/pull/1347) 的方式：固定上游实现和语义依据，按现有 facts 与证据契约挑选需要的行为，用真实输入与回归验证，避免仅因 JDT LS 提供某项 LSP 能力就增加服务器、工作区和逐点请求。JDT 的定义、继承、编译 source set 规则可作为语义参照；JavaScript 解析库主要负责语法层。

## 候选项目

| 项目 | 本轮核对的优点 | 对 Archify 的限制与结论 |
| --- | --- | --- |
| [JHipster `java-parser`](https://github.com/jhipster/prettier-java/tree/main/packages/java-parser) | 现有依赖；纯 JS、同步 CST/token API，现有提取链和 UTF-16 位置已按它验证。Apache-2.0。 | 不提供跨文件符号绑定。保留为默认语法前端，针对证实的语法缺口处理。 |
| [Tree-sitter Java](https://github.com/tree-sitter/tree-sitter-java) | Node 原生绑定解析快，错误节点与增量解析适合编辑器场景。MIT。 | 原生包增加跨平台构建/分发义务；[WebAssembly 版本](https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md#running-wasm-in-nodejs)可避开原生绑定，但官方指出 Node 中明显更慢。仍没有项目符号绑定；暂不为解析速度替换现有事实提取器。 |
| [`java-ast`](https://github.com/pascalgn/java-ast) | antlr4ts 生成树和 visitor API 可参考遍历方式。MIT。 | npm 0.4.1 依赖 `antlr4ts` alpha；实测 malformed 源码从 `parse()` 返回树并把错误写到 stderr，调用方需另接错误监听。与现有 CST 替换成本大，未发现语义绑定收益。 |
| [`java-model`](https://github.com/pascalgn/java-model) | 在 `java-ast` 之上提供多文件类型遍历、限定名和属性 API，可参考类型索引组织。MIT。 | README 没有展示调用点到方法声明的绑定；体量和已验证行为不足以让现有类型索引整体迁移。 |
| [ANTLR Java grammar](https://github.com/antlr/grammars-v4/blob/master/java/java/README.md) + [TypeScript target](https://github.com/antlr/antlr4/blob/dev/doc/typescript-target.md) | 语法可生成 TS parser/visitor；官方仓库给出 Java 语法和测试。 | 是自建语法前端的材料，不是可直接用的 Java 项目解析器；其 README 也明确优化版不完全等同 JLS。当前没有为它重写提取器的收益证据。 |
| [`node-pom-parser`](https://github.com/intuit/node-pom-parser) | 把 POM XML 转为 JS 对象。MIT。 | 文档的功能是 XML 结构解析，没有父模型合并、profile 与有效依赖求值。不能代替 Archify 当前受限的项目证据模型。 |

“没有完整绑定”只指本次核对的这些项目及其公开 API，不能据此断言 JS 生态中绝对不存在其他实现。[JavaParser + JavaSymbolSolver](https://github.com/javaparser/javaparser/blob/master/doc/readme.md) 是真正提供声明关系的另一个候选，但它运行在 JVM，不属于这轮 JS 库选型。这里保留 `java-parser` 的结论，只适用于现阶段已证实的小缺口；它不是反对使用 Java 自身做下一阶段语义分析的结论。

## Java 自身的批量分析路线

Java 可直接使用 JDK 的 [Compiler Tree API](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.compiler/module-summary.html)：`JavacTask.parse()/analyze()` 建立语法树和语义信息，`Trees.getElement(TreePath)` 与源码位置 API 可把调用映射到声明。另一个与 JDT 更贴近的选择是 [JDT Core `ASTParser`](https://help.eclipse.org/latest/topic/org.eclipse.jdt.doc.isv/reference/api/org/eclipse/jdt/core/dom/ASTParser.html)：显式给出环境后启用 `resolveBinding`，并能批量创建 AST。当前已把 JDK 批量 helper 做成可选源码目标增强；固定输入、原 JS 和增强模式的对照在 [JDK 绑定实验](../../benchmarks/java-binding-probe/README.md)。这里没有比较 JDT Core，也没有启用 JDT LS 协议。

版本成本需要拆开看：JDK 编译器支持的语言版本随运行 JDK 变化，`--release` 只覆盖当前及有限的既往版本，preview 功能还要求对应版本；JDT Core 则要升级并固定自己的解析器版本。无论选哪一条，绑定质量都依赖实际 source path、classpath、模块路径和目标项目的构建配置。JDT LS 之所以有 Maven/Gradle 支持，是因为它还集成了 M2Eclipse 与 Buildship；单独调用 JDT Core 或 javac 不会自动得到这些项目模型。[`javac` 文档](https://docs.oracle.com/en/java/javase/25/docs/specs/man/javac.html)还说明可用 `-proc:none` 禁用注解处理，符合本产品只读分析的约束。

## 固定源码试跑

只计 **parse 阶段**：同一个 Node 20.20.2 进程预先读取源码、按固定顺序各解析一遍，没有包含 Archify 的 facts/索引/项目证据，也未做重复采样或清缓存。Tree-sitter 0.21.1 + Java grammar 0.23.5 的 Node API 对大文件要显式设置 `bufferSize: source.length + 1024`；默认值在本次 Commons Lang 的 66 个大文件上抛出 `Invalid argument`，这属于调用配置，不计作语法失败。

| 固定输入 | `java-parser@3.0.1` | Tree-sitter Java | `java-ast@0.4.1` |
| --- | --- | --- | --- |
| Spring Petclinic，50 个 `.java` | 156 ms，0 失败 | 11 ms，0 错误节点 | 401 ms，0 异常 |
| Apache Commons Lang，638 个 `.java` | 2,289 ms，0 失败 | 461 ms，1 个文件有错误节点 | 12,215 ms，0 异常；stderr 为空 |

Tree-sitter 的一处错误节点位于 `ClassUtilsOssFuzzTest.java` 的长 Unicode escape fuzz 字符串；它与 `java-parser` 的成功结果存在差异，但此实验没有核对该源码在目标 JDK 下的编译结论。`java-ast` 的“0 异常”只表示调用未抛错，不等于 parser 没有恢复过语法错误。速度只说明解析器阶段，不预测整体提取耗时或正确性。

先前的 JDT LS 实验在相同固定项目上对七组 raw facts 做了逐字段对照：Petclinic 约 0.9 秒→5.6 秒，Commons Lang 约 43.8 秒→73.5 秒；它没有带来这两份输入上的事实增量。这个单次实验也不证明 Java 语言服务一般无价值，只说明当前产品范围不值得保留该运行时成本。

## 本轮处理的现有问题

1. Maven 模块的 main 源码可借同模块 `src/test/java` 的祖先来证明继承 qualifier，进而给出不应存在的调用目标。现在 main→test 的证据被拒绝。
2. 子 POM 用 `${project.groupId}` 等属性声明与父 POM 相同的依赖键时，原逻辑先按原始文本合并，展开后可能留下两条路线并让父项获得错误的优先级。现在在有效坐标上再次合并，子项覆盖父项；同一个有效层级内的碰撞保守报未知。[Maven 的依赖机制](https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html#dependency-management)明确当前 POM 的管理项优先于父 POM。
3. 对 `hashCode` 等 `Object` 方法名的一律拒绝，是原文档明确写出的覆盖限制，但也会漏掉合法的本类 `static hashCode(int)` 重载。本轮将这处已确认的覆盖缺口缩小：仍要求唯一、固定实参数量和原有源码证据，但不按名称排除；[JLS 的方法声明规则](https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html)允许不同签名的重载。
4. main 源码直接调用同一 Maven 模块 `src/test/java` 中唯一的静态方法时，旧的全局类型索引仍给出可导航目标，import/type 依赖也错误指向测试文件。现在只拒绝该 main→test 绑定；test→main 和通过其他模块显式 compile-scope `test-jar` 引入测试源码的路径保留。main/test 中重复声明的同名类型继续保持歧义。
5. Maven archetype 的 `src/main/resources/archetype-resources/pom.xml` 原会被当作独立项目和保存导航的构建输入。现在模板 POM 不再仅因其位置成为 Java 模块边界或解析输入；修改未被显式引用的模板不会使无关的已保存调用导航失效。
6. JDT Core `testInterfaceX` 的已捕获父类有受保护成员接口，子类的 `implements` 位置原只得到 unknown。现在只有完整继承链中唯一的 public/protected 源码成员类型能落到声明文件；私有、包内、重复声明和不完整继承链仍不猜目标。

这些修复均有公开提取入口的回归用例。迁移到 Labs `457d71b9` 并补齐下述 JDT 启发的边界用例后，Java 与相关共享行为的 14 个聚焦及集成测试文件共 147 项，其中 141 项通过、6 项因未配置外部 `jscpd` 可执行文件而跳过。打包安装检查 8 项通过（官方 Node 22.23.2）；适配器修订从 11 升到 12，以防新旧捕获误作同一 producer 比较。

原基线 `197980b7` 与修复初版的真实项目 facts 对照：Petclinic（50 文件、1,609 调用）所有检查的原始事实组一致；Commons Lang（638 文件、83,141 调用）只有 `calls` 改变。具体是 23 个原本因 `Object` 同名而未知的调用得到本类静态目标，包括 `AnnotationUtils.equals(Annotation, Annotation)`、`ObjectUtils.clone(T)` 等不同签名重载；另外 61 个仍无目标，只把原因从一般的 `no-local-function-binding` 细分为 `ambiguous-binding`。其余文件、import、符号、函数、项目范围和 unresolved 统计保持一致。

继承成员类型扩展前的 Labs `457d71b9` 工作树也重新提取了两份真实源码，并与保存的 JDT LS 试跑 JSON 逐组比对：Petclinic 的 files、imports、symbols、functions、calls、unresolved 全相同；Commons Lang 的这些组中仅 calls 有上述 84 项差异，10,944 条 imports 不变，两份输入均无 parse error。旧 JSON 的 `languageScope.jdtls` 是试跑元数据，因此项目范围对象不能直接等同比较。这是跨修订快照核对，不将它误写成只针对 main→test 修复的受控前后实验。

针对本轮 archetype marker 修复，还把修复前同一 Labs 工作树留下的两份 JSON 与修复后重新提取结果对比：Petclinic 50 文件、Commons Lang 638 文件的 files、packageMarkers、imports、symbols、functions、calls、unresolved、languageScope 八组均逐字段一致，parse error 均为零。这个对照验证真实项目未受该特殊模板路径规则影响；实际修复收益由 archetype 模板 fixture 的红灯与绿灯提供。

针对继承成员类型扩展，用同一 Labs 工作树的扩展前后 JSON 对照：Petclinic 50 文件的八组 facts 全同；Commons Lang 638 文件的 files、packageMarkers、symbols、functions、calls、languageScope 全同，59 个原 unknown 类型引用变成指向已捕获祖先声明文件的依赖边，18 个原 unknown 的同文件引用不再作为跨文件边，新增 0 条无目标引用，原已解析边无回退。人工抽查 `AbstractReflection.AbstractBuilder`、`AbstractCircuitBreaker.State` 等声明与引用；这是对实际增量的证据，不代替完整 classpath 语义验证。

## 选型与下一步证据

[#1347 的维护者结论](https://github.com/tt-a1i/archify/pull/1347#issuecomment-6859076080)将有直接收益、无需新工具链的 Go 修复经 [#1354](https://github.com/tt-a1i/archify/pull/1354) 合入 Labs；完整 loader 因现有证据仅显示持平，尚不足以抵偿 SDK 门槛、下载和维护成本而暂缓。这是价值与成本的取舍，并非否定使用语言自身做分析。对应地，Java 先交付本轮已复现的源码可见性、Maven 依赖优先级、继承成员类型和静态调用覆盖修复；不把 JDT LS 实验并入这组改动。

默认修复继续使用 `java-parser`。可选 JDK 增强已在 [固定绑定实验](../../benchmarks/java-binding-probe/README.md) 中核对：Commons Lang 的 9,922 个两边同位置调用中，JDK 对 5,135 个给出项目内源码声明；JS 原已给出的 1,357 个目标在文件、声明行和列上均一致，增强模式补齐剩余 3,778 个，新增目标与 JDK 的文件/声明位置冲突为零。受控双模块 Maven fixture 的两条实例调用也得到源码目标，但它不是实际多模块项目。移除 fixture 的直接依赖后，独立 JDK oracle 仍可绑定全部调用；增强模式的项目证据检查撤销原 JS 的两条跨模块静态目标，说明语义绑定和 Maven 可见性必须分别证明。

下一阶段需用固定的真实多模块及外部依赖项目量化可选模式的可用率、误绑定、解析失败、完整 facts 差异、整体耗时、包体、版本及离线成本。增强路径已经按 captured source set 与直接依赖分组、在写入目标时再核验构建证据；没有证据的跨模块静态候选也会撤销。只有跨更多项目的重复收益足以抵偿兼容和分发成本时，才考虑默认启用或扩展 classpath。Tree-sitter 值得在**解析器本身**成为瓶颈或 `java-parser` 出现无法受控处理的语法缺口时重新评估；其解析速度本身还不足以触发替换。

本次没有验证 Gradle、完整 Maven effective model、JPMS、外部依赖类型、生成源码、构造器或虚调用分派。这些能力仍按 [Java 产品边界](../../archify/modules/code-analysis/docs/JAVA.md) 标为未知，不以这份解析器试跑宣称修复。

## 上游测试对照（2026-11-16）

以 [JDT LS `af3be304`](https://github.com/eclipse-jdtls/eclipse.jdt.ls/tree/af3be304735d76d42fae8edf471944d2d6fbc744) 与 [JDT Core `dd2c874`](https://github.com/eclipse-jdt/eclipse.jdt.core/tree/dd2c87485ce2f01b4fc88167f1db701dd6540b35) 的固定提交为参照，按 Archify 已承诺的源码导航边界取舍，不照搬语言服务器的全套测试。

逐项记录见 [JDT LS 91 个启用测试清单](code-analysis-java-jdt-test-alignment.md)与 [JDT Core 173 个测试清单](code-analysis-java-jdt-core-alignment.md)；下表保留直接影响这次实现的对照结论。

| 上游用例 | 对当前契约的判断 | 本工作树的保护 |
| --- | --- | --- |
| [JDT LS `MavenClasspathTest.testMain/testTest`](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/af3be304735d76d42fae8edf471944d2d6fbc744/org.eclipse.jdt.ls.tests/src/org/eclipse/jdt/ls/core/internal/managers/MavenClasspathTest.java#L58-L84) 将 test 依赖隔离在测试源码 classpath。 | 这是我们 Maven 直接依赖路由和同模块 main/test 源码可见性的实际边界；旧用例把测试父类和目标依赖混在一起，不能单独识别 scope 错误。 | 新增同一目标在 `test`/`runtime` scope 下的 main/test 调用者矩阵；再用公开提取入口覆盖同模块 main→test 的调用与类型依赖、重复声明、test→main，以及跨模块 compile-scope `test-jar` 正例。 |
| [JDT LS 同名 artifact 与重复坐标用例](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/af3be304735d76d42fae8edf471944d2d6fbc744/org.eclipse.jdt.ls.tests/src/org/eclipse/jdt/ls/core/internal/managers/MavenProjectImporterTest.java#L529-L555)。 | 完整坐标应区分同名模块；重复 reactor 坐标不能证明唯一源码目标。Archify 的结果是保守拒绝导航，不模拟 JDT 的项目导入 UI。 | 新增同 artifactId、不同 groupId 的正例和重复 GAV 的拒绝例；取消唯一性检查时回归失败。 |
| [JDT LS 对 archetype 内层 POM 的更新保护](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/af3be304735d76d42fae8edf471944d2d6fbc744/org.eclipse.jdt.ls.tests/src/org/eclipse/jdt/ls/core/internal/managers/MavenBuildSupportTest.java#L130-L156)。 | 内层模板不是构建模块。旧实现会把它列入 `languageScope.projects/metadata`，模板变化还会让已保存的调用失效。 | 新增红灯复现后在 Java 捕获入口过滤该模板 marker；公开输出验证不生成项目、元数据或失效导航。 |
| [JDT LS 无效项目隔离](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/af3be304735d76d42fae8edf471944d2d6fbc744/org.eclipse.jdt.ls.tests/src/org/eclipse/jdt/ls/core/internal/managers/MavenBuildSupportTest.java#L109-L129) 与 [`MavenProjectImporterTest.testInvalidProject`](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/af3be304735d76d42fae8edf471944d2d6fbc744/org.eclipse.jdt.ls.tests/src/org/eclipse/jdt/ls/core/internal/managers/MavenProjectImporterTest.java#L587-L605)。 | 无效兄弟 POM 应被记录为不可用，而不抹去其他已证明的直接项目路由。 | 新增公开提取入口回归；无效 POM 进入 `unknowns`，有效模块的调用目标保留。 |
| [JDT LS `testNodeModules`](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/af3be304735d76d42fae8edf471944d2d6fbc744/org.eclipse.jdt.ls.tests/src/org/eclipse/jdt/ls/core/internal/managers/MavenProjectImporterTest.java#L108-L136)。 | `node_modules` 不应成为 Java 源码或模块 marker。 | 扩展现有 Java 捕获用例，验证两者均未进入公开 facts。 |
| [JDT LS call hierarchy 的多个调用范围](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/af3be304735d76d42fae8edf471944d2d6fbc744/org.eclipse.jdt.ls.tests/src/org/eclipse/jdt/ls/core/internal/handlers/CallHierarchyHandlerTest.java#L107-L122)。 | 同一调用者里两次调用同一方法时，Java 变更调查不能把调用点合并成一个。 | 扩展现有 paired-reference 用例，在同一行放两个调用点，验证两侧都保留两条不同位置的可导航引用。 |
| [JDT LS references 的潜在匹配与搜索范围](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/af3be304735d76d42fae8edf471944d2d6fbc744/org.eclipse.jdt.ls.tests/src/org/eclipse/jdt/ls/core/internal/handlers/ReferencesHandlerTest.java#L148-L210)，[JDT Core 模糊/重复方法选择](https://github.com/eclipse-jdt/eclipse.jdt.core/blob/dd2c87485ce2f01b4fc88167f1db701dd6540b35/org.eclipse.jdt.core.tests.model/src/org/eclipse/jdt/core/tests/model/ResolveTests.java#L85-L113)。 | 已有 Java 同参数量重载、重复类型和来源不确定时不给目标的回归；不做 JDT 的类型推断或项目级搜索。 | 复用 `java-qualified-calls.test.mjs`、`extract-java.test.mjs`，不增加同一路径的重复断言。 |
| [JDT Core `testSecondaryTypes`](https://github.com/eclipse-jdt/eclipse.jdt.core/blob/dd2c87485ce2f01b4fc88167f1db701dd6540b35/org.eclipse.jdt.core.tests.model/src/org/eclipse/jdt/core/tests/model/ResolveTests.java#L2311-L2327) 在文件名不同的源码中找到次级顶层类型。 | 属于当前类型依赖索引承诺的行为；实现已枚举同文件的全部顶层声明，但旧测试没有独立保护该结果。 | 新增公开提取入口用例，验证另一文件引用 `Secondary` 时依赖边指向 `Primary.java`。 |
| [JDT Core `testClass1`–`testClass6`](https://github.com/eclipse-jdt/eclipse.jdt.core/blob/dd2c87485ce2f01b4fc88167f1db701dd6540b35/org.eclipse.jdt.core.tests.model/src/org/eclipse/jdt/core/tests/model/ResolveTests.java#L216-L286) 与 [catch 类型用例](https://github.com/eclipse-jdt/eclipse.jdt.core/blob/dd2c87485ce2f01b4fc88167f1db701dd6540b35/org.eclipse.jdt.core.tests.model/src/org/eclipse/jdt/core/tests/model/ResolveTests.java#L178-L201)。 | 字段、局部、数组创建、返回、参数、父类和 catch 类型引用均在现有依赖范围内。 | 用同一捕获目标逐个核对七种源码位置；全部在公开 facts 中落到声明文件。 |
| [JDT Core 重复方法和类型声明](https://github.com/eclipse-jdt/eclipse.jdt.core/blob/dd2c87485ce2f01b4fc88167f1db701dd6540b35/org.eclipse.jdt.core.tests.model/src/org/eclipse/jdt/core/tests/model/ResolveTests.java#L1723-L2033)。 | JDT 能在非法重复源码里按光标选中某个声明；Archify 的跨文件事实不能据此猜唯一目标。 | 新增同文件重复顶层类型与同签名静态方法回归，分别保持未解析依赖与 `ambiguous-binding`。 |
| [JDT Core `testInterfaceX`](https://github.com/eclipse-jdt/eclipse.jdt.core/blob/dd2c87485ce2f01b4fc88167f1db701dd6540b35/org.eclipse.jdt.core.tests.model/src/org/eclipse/jdt/core/tests/model/ResolveTests.java#L2573-L2600) 的受保护继承成员接口。 | 已捕获且完整的父类链能证明唯一的 public/protected 成员类型；`implements` 中的类型边应指向父类源码。 | 最小用例先红后绿；再验证私有、包内、重复和未知父链不生成目标。Commons Lang 中 59 个原 unknown 引用得到源码目标。 |
| [JDT LS definition](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/af3be304735d76d42fae8edf471944d2d6fbc744/org.eclipse.jdt.ls.tests/src/org/eclipse/jdt/ls/core/internal/handlers/NavigateToDefinitionHandlerTest.java#L67-L156) 和 [call hierarchy](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/af3be304735d76d42fae8edf471944d2d6fbc744/org.eclipse.jdt.ls.tests/src/org/eclipse/jdt/ls/core/internal/handlers/CallHierarchyHandlerTest.java#L88-L170) 覆盖附带源码、二进制/JDK、匿名类、构造器等。 | 属于当前 captured-source 静态方法模型之外；现有测试已验证这些调用可计入 inventory，但不声称可导航目标。 | 暂不移植行为断言；如后续 Java helper 试验取得增量收益，再用固定项目和查询比较。 |
| [JDT Core 的 Unicode 转义标识符解析](https://github.com/eclipse-jdt/eclipse.jdt.core/blob/dd2c87485ce2f01b4fc88167f1db701dd6540b35/org.eclipse.jdt.core.tests.model/src/org/eclipse/jdt/core/tests/model/ResolveTests.java#L1259-L1299)。 | 当前解析器对会改变 token 边界的 Unicode 转义给 parse error；现有源码测试验证这一显式边界。Petclinic 无此转义，Commons Lang 的 32 个含转义文件均成功解析。 | 本轮无真实输入增量证据，不引入需要维护原始源码偏移映射的预处理层；保留诊断与后续独立验证条件。 |

JDT LS 的 Java 21–27 项目导入测试使用的 `Test.java` 基本是空类，验证的是项目语言级配置，不足以证明那些版本的新语法已被当前 `java-parser` 支持。因此不把导入测试数量当成语法覆盖率。

小范围消融验证：去掉构建证据中的 main/test 检查后，同模块测试父类重新让 main 调用获得错误目标；去掉 import 候选的可见性检查后，同模块 main→test 依赖边重新出现；去掉继承成员类型的可见性检查后，私有成员接口被错误地解析为已知目标。三处检查均已恢复。import 与调用共用一处候选过滤逻辑，POM 的有效坐标合并仍保留，以避免属性展开后的父子项碰撞。
