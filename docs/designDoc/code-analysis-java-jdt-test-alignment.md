# Java 源码提取与 JDT 测试逐项对照

固定上游：JDT LS [`af3be304`](https://github.com/eclipse-jdtls/eclipse.jdt.ls/tree/af3be304735d76d42fae8edf471944d2d6fbc744)，JDT Core [`dd2c874`](https://github.com/eclipse-jdt/eclipse.jdt.core/tree/dd2c87485ce2f01b4fc88167f1db701dd6540b35)。本表按测试断言对照 Archify **默认 JS v5 基线**的公开 `extractFacts`、保存问答或配对问答结果。表中的“界外”指该断言没有基线 Java source-only facts 的对应输出，并非认为该能力永远不需要；要引入时须先定义可验证的用户查询与构建输入。可选 JDK v6 已补充项目内实例、重载和接口方法目标，覆盖结果见[固定绑定实验](../../benchmarks/java-binding-probe/README.md)；本表未逐项重判 v6。

## Maven 项目与 classpath

来源：[MavenClasspathTest](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/af3be304735d76d42fae8edf471944d2d6fbc744/org.eclipse.jdt.ls.tests/src/org/eclipse/jdt/ls/core/internal/managers/MavenClasspathTest.java)、[MavenProjectImporterTest](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/af3be304735d76d42fae8edf471944d2d6fbc744/org.eclipse.jdt.ls.tests/src/org/eclipse/jdt/ls/core/internal/managers/MavenProjectImporterTest.java)、[MavenBuildSupportTest](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/af3be304735d76d42fae8edf471944d2d6fbc744/org.eclipse.jdt.ls.tests/src/org/eclipse/jdt/ls/core/internal/managers/MavenBuildSupportTest.java)。本组共 54 个启用的 `@Test`，逐项如下。相关本地回归集中在 `java-projects.test.mjs` 和 `extract-java.test.mjs`。

| 上游测试 | 断言与本地对齐结果 |
| --- | --- |
| `MavenClasspathTest.testMain` | main 编译 classpath 不含 test 依赖；同模块 main→test 父类、直接调用和类型边被拒绝，跨模块 test scope 不授予 main 路由。 |
| `MavenClasspathTest.testTest` | test 可见 test 依赖；本地覆盖 test→main、test/runtime scope 和显式跨模块 test-jar，另保留 main 使用 compile-scope test-jar 的正例。 |
| `MavenClasspathTest.typemismatchTest` | 改动工作副本后无编译诊断错误；界外，Archify 不增量编译。 |
| `MavenProjectImporterTest.testImportSimpleJavaProject` | Eclipse 导入任务和进度完成；界外，Archify 只读捕获。 |
| `testJavaImportExclusions` | 排除指定项目；本地 `config.exclude` 和被排除的父 POM 测试覆盖不进入路由。 |
| `testNodeModules` | 不扫描 `node_modules`；Java 捕获回归验证源码与 POM marker 均不进入 facts。 |
| `testUnzippedSourceImportExclusions` | 不把解压源码当工作区项目；界外，无 Eclipse 项目导入。 |
| `testDisableMaven` | 关闭 Maven importer 后仍可导入 Eclipse 项目；界外，无 importer 开关。 |
| `testUnchangedProjectShouldNotBeUpdated` | 相同 POM 不触发后台更新；界外，Archify 每次从快照提取。 |
| `testChangedProjectShouldBeUpdated` | POM 变化触发项目更新；对应保存问答在用过的 POM 变化后失效，重新提取才可使用新证据。 |
| `testDigestStoreBatchUpdate` | 文件内容摘要在批量与重建后稳定；本地验证捕获 POM 的 SHA-256 与修改后的失效判定，不维护 Eclipse digest store。 |
| `testPreexistingIProjectDifferentName` | 预存 Eclipse 项目位置可更新；界外，无工作区项目对象。 |
| `testPreexistingIProjectSameName` | 同名预存 Eclipse 项目可更新；界外，无工作区项目对象。 |
| `testJava9Project` | Maven 导入配置 Java 9 语言级；界外，当前提取器不按 POM 语言级编译。 |
| `testJava110Project` | Java 9 以上的 `1.10` 配置；界外，同上。 |
| `testJava10Project` | Java 10 语言级；界外，同上。 |
| `testJava11Project` | Java 11 语言级；界外，同上。 |
| `testJava12Project` | Java 12 语言级；界外，同上。 |
| `testJava13Project` | Java 13 语言级；界外，同上。 |
| `testJava14Project` | Java 14 语言级；界外，同上。 |
| `testJava15Project` | Java 15 语言级；界外，同上。 |
| `testJava16Project` | Java 16 语言级；界外，同上。 |
| `testJava17Project` | Java 17 语言级；界外，同上。 |
| `testJava18Project` | Java 18 语言级；界外，同上。 |
| `testJava19Project` | Java 19 语言级；界外，同上。 |
| `testJava20Project` | Java 20 语言级；界外，同上。 |
| `testJava21Project` | Java 21 语言级；界外，同上。 |
| `testJava22Project` | Java 22 语言级；界外，同上。 |
| `testJava23Project` | Java 23 语言级；界外，同上。 |
| `testJava24Project` | Java 24 语言级；界外，同上。 |
| `testJava25Project` | Java 25 语言级；界外，同上。 |
| `testJava26Project` | Java 26 语言级及 preview 配置；界外，同上。 |
| `testJava27Project` | Java 27 语言级及 preview 配置；界外，同上。 |
| `testAnnotationProcessing` | 运行处理器并生成源码；界外，Archify 明确不执行项目代码或注解处理器。 |
| `avoidImportDuplicatedProjects` | Maven 与 Eclipse 双构建工具不重复导入；界外，无 Eclipse 项目导入。 |
| `avoidImportDuplicatedProjects2` | 已导入双构建工具项目不重复导入；界外，同上。 |
| `testNullAnalysisDisabled` | 编译器空值诊断选项；界外，无编译诊断。 |
| `testImportModulesWithSameArtifactId` | 不同 groupId 的同名 artifact 是不同项目；本地直接路由正例。 |
| `testDuplicateGroupIdArtifactId` | 重复 GAV 不得到唯一项目；本地调用标为 unresolved，拒绝导航。 |
| `testImportWithProjectNameTemplate` | 同 groupId/artifactId、不同 version 的项目能分别命名；本地按完整 GAV 区分直接路由，UI 命名模板界外。 |
| `testImportWithProjectNameTemplateByFolder` | 按目录应用 Eclipse 项目名模板；界外。 |
| `testInvalidProject` | 无效项目不妨碍有效模块；本地无效兄弟 POM 进入 `unknowns`，有效直接路由保留。 |
| `MavenBuildSupportTest.testUpdate` | 手动更新 POM 后重建并刷新诊断；本地以捕获快照与 POM freshness 对应，后台编译界外。 |
| `testCompileWithErrorProne` | 非标准编译器插件可编译；界外，不运行 Maven 插件。 |
| `testCompileWithEclipse` | 非标准编译器插件可编译；界外，同上。 |
| `testCompileWithEclipseTychoJdt` | 非标准编译器插件可编译；界外，同上。 |
| `testInvalidProjects` | 无效模块不扩散为有效项目；本地无效兄弟 POM 隔离回归。 |
| `testMultipleProjects` | reactor 中的多个真实模块可枚举；本地显式 modules、唯一完整坐标和直接依赖构成路由。 |
| `testIgnoreInnerPomChanges` | archetype 模板 POM 不触发项目更新；先复现它被误列项目/输入，再过滤 marker 并验证模板修改不使保存导航失效。 |
| `testBuildHelperSupport` | build-helper 插件添加源码目录；当前只承认常规 main/test 布局，新目录不授予跨项目路由；插件执行界外。 |
| `testDownloadSources` | 获取二进制依赖附带源码；界外，Archify 不解析远端 artifact。 |
| `testDownloadSourcesWhenSHA1SearchFails` | SHA1 查询失败时仍可下载源码；界外，同上。 |
| `testUpdateSnapshots` | 更新 SNAPSHOT 后刷新工作区 classpath；界外，无依赖下载或后台 classpath。 |
| `testBatchImport` | 批量导入工作区项目；界外，无工作区导入过程。 |

Maven 组的 54 个测试方法均在表中。

## 定义、类型定义、引用与调用层级

来源：[NavigateToDefinitionHandlerTest](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/af3be304735d76d42fae8edf471944d2d6fbc744/org.eclipse.jdt.ls.tests/src/org/eclipse/jdt/ls/core/internal/handlers/NavigateToDefinitionHandlerTest.java)、[NavigateToTypeDefinitionHandlerTest](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/af3be304735d76d42fae8edf471944d2d6fbc744/org.eclipse.jdt.ls.tests/src/org/eclipse/jdt/ls/core/internal/handlers/NavigateToTypeDefinitionHandlerTest.java)、[ReferencesHandlerTest](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/af3be304735d76d42fae8edf471944d2d6fbc744/org.eclipse.jdt.ls.tests/src/org/eclipse/jdt/ls/core/internal/handlers/ReferencesHandlerTest.java)、[CallHierarchyHandlerTest](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/af3be304735d76d42fae8edf471944d2d6fbc744/org.eclipse.jdt.ls.tests/src/org/eclipse/jdt/ls/core/internal/handlers/CallHierarchyHandlerTest.java)。本组 37 个启用的 `@Test`；被注释掉的两个递归测试不计入。

| 上游测试 | 断言与本地对齐结果 |
| --- | --- |
| `NavigateToDefinitionHandlerTest.testGetEmptyDefinition` | 不存在的文档位置返回空定义；界外，无任意光标位置的 LSP 查询。 |
| `testAttachedSource` | 二进制依赖的附带源码可导航；界外，只读捕获的 `.java`。 |
| `testNoClassContentSupport` | 客户端不支持 class-file 内容时不给二进制定义；界外，无客户端协议。 |
| `testDisassembledSource` | 反编译 JDK class-file 后给位置；界外，无反编译。 |
| `testSourceVersion` | 二进制 class-file 的源码版本位置；界外。 |
| `testMethodInAnonymousClass` | 二进制匿名类方法导航；界外，当前仅计入匿名类调用点而不给其目标。 |
| `testMethodInAnonymousClass2` | 另一种二进制匿名类方法导航；界外，同上。 |
| `testJdkClasses` | JDK/二进制 class-file 定义；界外，无 JDK 类路径。 |
| `testKotlin` | 从 Java class-file 导航至 Kotlin 源；界外，当前 Java 源码提取不跨语言绑定。 |
| `testBreakContinue` | 光标处的 break/continue 跳转至标签；界外，facts 不含控制流标签定义。 |
| `NavigateToTypeDefinitionHandlerTest.testGetEmptyDefinition` | 不存在文档的类型定义请求返回空；界外，无 LSP 位置查询。 |
| `testAttachedSource` | 附带源码的类型定义；界外，无二进制依赖源码。 |
| `testLocalVariable` | 在 class-file 的局部变量位置找声明类型；界外，无变量符号绑定。 |
| `testDisassembledSource` | 在反编译 class-file 上找类型；界外。 |
| `testClassField` | 在 class-file 字段位置找类型；界外，无字段符号绑定。 |
| `testExternalClassField` | 外部字段声明类型；界外，同上。 |
| `testNoClassContentSupport` | 客户端不支持 class-file 时不给类型位置；界外。 |
| `ReferencesHandlerTest.testEmpty` | 无文档返回空引用；界外，无任意位置引用 API。 |
| `testReference` | 从源文件找另一个源文件的引用；当前只对唯一静态方法目标提供已知调用引用，通用符号引用界外。 |
| `testIncludeAccessors` | 偏好设置改变字段访问器引用数量；界外，无属性/访问器符号模型。 |
| `testEnumInClassFile` | 从二进制枚举搜索源与二进制引用；界外。 |
| `testProjectOnlySearchScope` | LSP 选择项目级搜索范围；界外，Archify 的捕获根与配置决定范围。 |
| `testPotentialMatch` | 潜在但不确定的搜索匹配不作真实引用；本地同参数量重载、重复类型和无构建证据的调用保留 unresolved，不进入已知引用。 |
| `testDeclarationInReferences` | LSP 可选择将声明自身列入引用结果；界外，已知引用只列调用点，定义单列。 |
| `testReferencesInJRE` | 搜索 JRE class-file 中的引用；界外。 |
| `CallHierarchyHandlerTest.prepareCallHierarchy_noItemAtLocation` | 无符号的光标位置不准备层级；界外，无 LSP 光标选择。 |
| `prepareCallHierarchy` | 字段可作为层级项；界外，调用 facts 不提供字段层级。 |
| `prepareCallHierarchy_src_enclosing` | 构造器区域定位外围项；界外，当前不绑定构造器调用。 |
| `incomingCalls_src` | 源码实例方法的构造器与方法调用者；界外，当前已知目标限于静态方法。 |
| `testSelectionRange` | 同一调用者到同一目标的两个源码范围均保留；本地配对引用测试在同一行验证两条不同位置的调用均可导航。LSP 的声明选择范围界外。 |
| `outgoingCalls_src` | 源码实例调用、构造器与 JDK 方法目标；界外，当前只列调用点 inventory。 |
| `incomingCalls_maven` | 附带源码的 jar 类型及构造器来电；界外，无二进制源码。 |
| `outgoing_jar` | jar 内源码方法的出向调用；界外。 |
| `incomingCalls_projectOnly` | 只在当前项目搜索 jar 方法调用者；界外，无 LSP 搜索范围。 |
| `incomingCalls_searchScopeChanged` | 动态切换搜索范围后结果变化；界外，无编辑器会话状态。 |
| `incomingCalls_OnInterfaceMethod` | 接口方法的层级返回零来电；界外，当前不绑定接口分派。 |
| `incomingCalls_OnInterfaceMethodReturnType` | 在接口方法返回类型处选择类型及其调用者；界外，无位置查询。 |

这 37 项已逐一判定。JDT 的 `definition`/`references` 是按工作区位置查询，Archify 则批量产生源码事实；相同的“可导航”字样不足以让二进制、光标选择或动态分派成为现有 facts 的隐含承诺。

JDT Core 的 173 个解析与 code-select 测试列在[逐项清单](code-analysis-java-jdt-core-alignment.md)。其中字段、局部变量、构造器、二进制源码和工作副本光标行为没有当前 facts 输出；源码类型位置、导入、歧义、继承成员类型与失效路径已在本工作树核对。改变 token 边界的 Unicode 转义标识符仍需独立的偏移证据。
