# JDT Core 测试逐项对照

固定源码：[JDT Core `dd2c874`](https://github.com/eclipse-jdt/eclipse.jdt.core/tree/dd2c87485ce2f01b4fc88167f1db701dd6540b35)。本表逐项记录 `ResolveTests`、`ResolveTests2` 和 `ASTParserTest` 的 173 个测试方法。分类按上游断言相对 Archify **默认 JS v5 source-only 基线**的关系：`已验` 是已用公开输出核对；`保守` 是 JDT 的光标选择比 Archify 全局唯一性更细；`边界` 是明确不产全局事实；`部分` 只保留跨文件依赖；`已知缺口` 需要额外语义或偏移证据；`界外` 没有基线产品输出。每项行号对应该固定提交。可选 JDK v6 的项目内方法目标覆盖另见[固定绑定实验](../../benchmarks/java-binding-probe/README.md)；本表未逐项重判 v6。

## [ResolveTests](https://github.com/eclipse-jdt/eclipse.jdt.core/blob/dd2c87485ce2f01b4fc88167f1db701dd6540b35/org.eclipse.jdt.core.tests.model/src/org/eclipse/jdt/core/tests/model/ResolveTests.java)

| 行 | 测试 | 对照结论 |
| ---: | --- | --- |
| 75 | `testAbstractMethod` | 边界：无方法体的签名不产函数测量；无声明光标选择。 |
| 85 | `testAmbiguousMethod1` | 已验：歧义方法不生成已知调用目标。 |
| 117 | `testArgumentName1` | 界外：局部变量或参数符号代码选择。 |
| 129 | `testArgumentName2` | 界外：局部变量或参数符号代码选择。 |
| 141 | `testArrayLength` | 界外：字段符号代码选择。 |
| 154 | `testCatchArgumentName1` | 界外：局部变量或参数符号代码选择。 |
| 166 | `testCatchArgumentName2` | 界外：局部变量或参数符号代码选择。 |
| 178 | `testCatchArgumentType1` | 已验：源码类型位置映射到文件依赖。 |
| 190 | `testCatchArgumentType2` | 已验：源码类型位置映射到文件依赖。 |
| 202 | `testCatchArgumentType3` | 界外：局部变量或参数符号代码选择。 |
| 216 | `testClass1` | 已验：源码类型位置映射到文件依赖。 |
| 228 | `testClass2` | 已验：源码类型位置映射到文件依赖。 |
| 240 | `testClass3` | 已验：源码类型位置映射到文件依赖。 |
| 252 | `testClass4` | 已验：源码类型位置映射到文件依赖。 |
| 264 | `testClass5` | 已验：源码类型位置映射到文件依赖。 |
| 276 | `testClass6` | 已验：源码类型位置映射到文件依赖。 |
| 288 | `testConstructor` | 界外：构造器调用或声明的代码选择。 |
| 300 | `testConstructor2` | 界外：构造器调用或声明的代码选择。 |
| 312 | `testConstructor3` | 界外：构造器调用或声明的代码选择。 |
| 335 | `testConstructor4` | 界外：构造器调用或声明的代码选择。 |
| 360 | `testConstructor5` | 界外：构造器调用或声明的代码选择。 |
| 382 | `testConstructor6` | 界外：构造器调用或声明的代码选择。 |
| 403 | `testConstructorCallOfMemberType` | 界外：构造器调用或声明的代码选择。 |
| 428 | `testConstructorDeclaration` | 界外：构造器调用或声明的代码选择。 |
| 440 | `testEmptyCU1` | 界外：非法工作副本中未知标识符的光标选择；Archify 只记录解析诊断。 |
| 459 | `testEmptySelection` | 界外：光标范围、工作副本顺序或位置校验。 |
| 471 | `testEmptySelection2` | 界外：光标范围、工作副本顺序或位置校验。 |
| 483 | `testEmptySelectionOnMethod` | 界外：光标范围、工作副本顺序或位置校验。 |
| 495 | `testExplicitSuperConstructorCall` | 界外：构造器调用或声明的代码选择。 |
| 507 | `testExplicitThisConstructorCall` | 界外：构造器调用或声明的代码选择。 |
| 519 | `testField` | 界外：字段符号代码选择。 |
| 531 | `testFieldDeclaration` | 界外：字段符号代码选择。 |
| 543 | `testImport` | 已验：源码 import 或成员/次级类型映射到文件依赖。 |
| 555 | `testInClassFileWithoutSource` | 界外：JDK 或 jar 二进制类型源码解析。 |
| 570 | `testInClassFileWithSource` | 界外：JDK 或 jar 二进制类型源码解析。 |
| 582 | `testInnerClassAsParamater` | 界外：依据内部类实参类型选择实例方法重载。 |
| 594 | `testInterface` | 已验：源码 import 或成员/次级类型映射到文件依赖。 |
| 606 | `testInvalidResolve` | 界外：光标范围、工作副本顺序或位置校验。 |
| 618 | `testLocalClass1` | 边界：局部类型不进入跨文件索引；局部光标选择界外。 |
| 630 | `testLocalClass2` | 边界：局部类型不进入跨文件索引；局部光标选择界外。 |
| 642 | `testLocalClass3` | 边界：局部类型不进入跨文件索引；局部光标选择界外。 |
| 654 | `testLocalClass4` | 边界：局部类型不进入跨文件索引；局部光标选择界外。 |
| 666 | `testLocalClass5` | 边界：局部类型不进入跨文件索引；局部光标选择界外。 |
| 678 | `testLocalClass6` | 边界：局部类型不进入跨文件索引；局部光标选择界外。 |
| 690 | `testLocalClass7` | 边界：局部类型不进入跨文件索引；局部光标选择界外。 |
| 702 | `testLocalClass8` | 边界：局部类型不进入跨文件索引；局部光标选择界外。 |
| 725 | `testLocalClass9` | 边界：局部类型不进入跨文件索引；局部光标选择界外。 |
| 752 | `testLocalConstructor` | 界外：构造器调用或声明的代码选择。 |
| 764 | `testLocalConstructorDeclaration` | 界外：构造器调用或声明的代码选择。 |
| 776 | `testLocalField` | 界外：字段符号代码选择。 |
| 788 | `testLocalField2` | 界外：字段符号代码选择。 |
| 800 | `testLocalFieldDeclaration` | 界外：字段符号代码选择。 |
| 812 | `testLocalMemberTypeDeclaration` | 边界：局部类型不进入跨文件索引；局部光标选择界外。 |
| 824 | `testLocalMemberTypeDeclaration2` | 边界：局部类型不进入跨文件索引；局部光标选择界外。 |
| 836 | `testLocalMethod` | 界外：任意实例方法、匿名类或错误恢复的代码选择。 |
| 848 | `testLocalMethod2` | 界外：任意实例方法、匿名类或错误恢复的代码选择。 |
| 860 | `testLocalMethodDeclaration` | 界外：任意实例方法、匿名类或错误恢复的代码选择。 |
| 872 | `testLocalName1` | 界外：局部变量或参数符号代码选择。 |
| 884 | `testLocalName2` | 界外：局部变量或参数符号代码选择。 |
| 896 | `testLocalName3` | 界外：局部变量或参数符号代码选择。 |
| 908 | `testLocalName4` | 界外：局部变量或参数符号代码选择。 |
| 920 | `testLocalName5` | 界外：局部变量或参数符号代码选择。 |
| 932 | `testLocalName6` | 界外：局部变量或参数符号代码选择。 |
| 944 | `testLocalName7` | 界外：局部变量或参数符号代码选择。 |
| 957 | `testLocalVarIsStructureKnown` | 界外：局部变量或参数符号代码选择。 |
| 964 | `testLocalVarTypeSignature1` | 界外：局部变量或参数符号代码选择。 |
| 974 | `testLocalVarTypeSignature2` | 界外：局部变量或参数符号代码选择。 |
| 984 | `testMemberTypeDeclaration` | 部分：成员类型供跨文件索引；声明处代码选择界外。 |
| 996 | `testMemberTypeDeclaration2` | 部分：成员类型供跨文件索引；声明处代码选择界外。 |
| 1008 | `testMessageSendOnBaseType` | 部分：调用点保留在 inventory，无法证明的目标不导航；光标选择界外。 |
| 1020 | `testMethod` | 界外：任意实例方法、匿名类或错误恢复的代码选择。 |
| 1032 | `testMethodDeclaration` | 界外：任意实例方法、匿名类或错误恢复的代码选择。 |
| 1045 | `testMethodDeclarationInAnonymous` | 界外：任意实例方法、匿名类或错误恢复的代码选择。 |
| 1058 | `testMethodDeclarationInAnonymous2` | 界外：任意实例方法、匿名类或错误恢复的代码选择。 |
| 1071 | `testMethodDeclarationInAnonymous3` | 界外：任意实例方法、匿名类或错误恢复的代码选择。 |
| 1084 | `testMethodDeclarationInAnonymous4` | 界外：任意实例方法、匿名类或错误恢复的代码选择。 |
| 1096 | `testMethodWithIncorrectParameter` | 界外：任意实例方法、匿名类或错误恢复的代码选择。 |
| 1106 | `testMethodWithIncorrectParameter2` | 界外：任意实例方法、匿名类或错误恢复的代码选择。 |
| 1133 | `testMethodWithInnerTypeInClassFile` | 界外：JDK 或 jar 二进制类型源码解析。 |
| 1145 | `testMethodWithInnerTypeInClassFile2` | 界外：JDK 或 jar 二进制类型源码解析。 |
| 1165 | `testNegativeResolveUnicode` | 已知缺口：改变 token 边界的 Unicode 转义保留 parse error。 |
| 1177 | `testPackage` | 界外：包符号代码选择。 |
| 1189 | `testPartiallyQualifiedType` | 界外：JDK 或 jar 二进制类型源码解析。 |
| 1201 | `testQualifiedType` | 界外：JDK 或 jar 二进制类型源码解析。 |
| 1213 | `testStaticClassConstructor` | 界外：构造器调用或声明的代码选择。 |
| 1225 | `testTypeDeclaration` | 界外：声明自身的光标选择。 |
| 1237 | `testTypeInComment` | 已验：注释文本不产生类型依赖。 |
| 1249 | `testUnicode` | 已知缺口：改变 token 边界的 Unicode 转义保留 parse error。 |
| 1259 | `testUnicode2` | 已知缺口：改变 token 边界的 Unicode 转义保留 parse error。 |
| 1282 | `testUnicode3` | 已知缺口：改变 token 边界的 Unicode 转义保留 parse error。 |
| 1305 | `testLocalNameForClassFile` | 界外：JDK 或 jar 二进制类型源码解析。 |
| 1367 | `testMethodDeclarationInInterface` | 界外：任意实例方法、匿名类或错误恢复的代码选择。 |
| 1377 | `testMethodInAnonymous1` | 界外：任意实例方法、匿名类或错误恢复的代码选择。 |
| 1415 | `testEndOfFile` | 界外：光标范围、工作副本顺序或位置校验。 |
| 1425 | `testDuplicateLocals1` | 界外：局部变量或参数符号代码选择。 |
| 1464 | `testDuplicateLocals2` | 界外：局部变量或参数符号代码选择。 |
| 1506 | `testDuplicateLocals3` | 界外：局部变量或参数符号代码选择。 |
| 1545 | `testDuplicateLocals4` | 界外：局部变量或参数符号代码选择。 |
| 1586 | `testDuplicateLocals5` | 界外：局部变量或参数符号代码选择。 |
| 1627 | `testDuplicateLocalsType1` | 界外：局部变量或参数符号代码选择。 |
| 1672 | `testDuplicateLocalsType2` | 界外：局部变量或参数符号代码选择。 |
| 1723 | `testDuplicateMethodDeclaration` | 保守：重复方法声明不作为唯一调用目标；无声明光标选择。 |
| 1740 | `testDuplicateMethodDeclaration2` | 保守：重复方法声明不作为唯一调用目标；无声明光标选择。 |
| 1754 | `testDuplicateMethodDeclaration3` | 保守：重复方法声明不作为唯一调用目标；无声明光标选择。 |
| 1768 | `testDuplicateMethodDeclaration4` | 保守：重复方法声明不作为唯一调用目标；无声明光标选择。 |
| 1782 | `testDuplicateMethodDeclaration5` | 保守：重复方法声明不作为唯一调用目标；无声明光标选择。 |
| 1796 | `testDuplicateMethodDeclaration6` | 保守：重复方法声明不作为唯一调用目标；无声明光标选择。 |
| 1810 | `testDuplicateMethodDeclaration7` | 保守：重复方法声明不作为唯一调用目标；无声明光标选择。 |
| 1824 | `testDuplicateMethodDeclaration8` | 保守：重复方法声明不作为唯一调用目标；无声明光标选择。 |
| 1838 | `testDuplicateMethodDeclaration9` | 保守：重复方法声明不作为唯一调用目标；无声明光标选择。 |
| 1852 | `testDuplicateMethodDeclaration10` | 保守：重复方法声明不作为唯一调用目标；无声明光标选择。 |
| 1866 | `testDuplicateMethodDeclaration11` | 保守：重复方法声明不作为唯一调用目标；无声明光标选择。 |
| 1880 | `testDuplicateMethodDeclaration12` | 保守：重复方法声明不作为唯一调用目标；无声明光标选择。 |
| 1894 | `testDuplicateFieldDeclaration` | 界外：字段符号代码选择。 |
| 1908 | `testDuplicateFieldDeclaration2` | 界外：字段符号代码选择。 |
| 1922 | `testDuplicateFieldDeclaration3` | 界外：字段符号代码选择。 |
| 1936 | `testDuplicateFieldDeclaration4` | 界外：字段符号代码选择。 |
| 1950 | `testDuplicateTypeDeclaration` | 保守：重复类型的全局候选不猜测；无声明光标选择。 |
| 1964 | `testDuplicateTypeDeclaration2` | 保守：重复类型的全局候选不猜测；无声明光标选择。 |
| 1978 | `testDuplicateTypeDeclaration3` | 保守：重复类型的全局候选不猜测；无声明光标选择。 |
| 1992 | `testDuplicateTypeDeclaration4` | 保守：重复类型的全局候选不猜测；无声明光标选择。 |
| 2006 | `testDuplicateTypeDeclaration5` | 保守：重复类型的全局候选不猜测；无声明光标选择。 |
| 2020 | `testDuplicateTypeDeclaration6` | 保守：重复类型的全局候选不猜测；无声明光标选择。 |
| 2035 | `testDuplicateTypeDeclaration7` | 界外：JDT 在同名二进制 jar 与源码工作副本之间选源码；当前没有二进制类路径。 |
| 2077 | `testDuplicateTypeDeclaration8` | 已验：两个包内的同名类型凭完整限定名区分；本地类型索引按完整包名绑定。 |
| 2112 | `testArrayParameterInsideParent1` | 界外：数组形参的局部符号代码选择。 |
| 2126 | `testDeepLocalVariable` | 界外：局部变量或参数符号代码选择。 |
| 2143 | `testLocalVariable` | 界外：局部变量或参数符号代码选择。 |
| 2155 | `testQualifiedName1` | 部分：完整限定名可落到声明文件；整段光标选择不输出。 |
| 2169 | `testQualifiedName2` | 部分：同一完整限定名可落到声明文件；从 `qq` 起选的范围不输出。 |
| 2183 | `testQualifiedName3` | 部分：同一完整限定名可落到声明文件；从 `XX` 起选的范围不输出。 |
| 2197 | `testQualifiedName4` | 部分：同一完整限定名可落到声明文件；从 `YY` 起选的范围不输出。 |
| 2211 | `testQualifiedName5` | 界外：同文件成员类型的光标选择；当前 facts 不产生自文件依赖边。 |
| 2223 | `testTypeInsideConstructor` | 界外：非法泛型声明中的工作副本光标恢复；Archify 只记录解析诊断。 |
| 2254 | `testMemberTypeInImport` | 已验：源码 import 或成员/次级类型映射到文件依赖。 |
| 2283 | `testSingleNameInImport` | 界外：包符号代码选择。 |
| 2314 | `testSecondaryTypes` | 已验：源码 import 或成员/次级类型映射到文件依赖。 |
| 2328 | `testSelectOnCursor1` | 界外：光标范围、工作副本顺序或位置校验。 |
| 2350 | `testSelectOnCursor2` | 界外：光标范围、工作副本顺序或位置校验。 |
| 2378 | `testWorkingCopyOrder1` | 界外：光标范围、工作副本顺序或位置校验。 |
| 2404 | `testWorkingCopyOrder2` | 界外：光标范围、工作副本顺序或位置校验。 |
| 2433 | `testInvalidField1` | 界外：错误字段链中间字段的光标选择；当前无字段引用目标。 |
| 2456 | `testInvalidField2` | 界外：错误字段链中间字段的光标选择；当前无字段引用目标。 |
| 2479 | `testInvalidField3` | 部分：末尾 `foo()` 调用点可计入 inventory，但错误字段链不给导航目标；光标选择界外。 |
| 2502 | `testInvalidField4` | 部分：末尾 `foo()` 调用点可计入 inventory，但错误字段链不给导航目标；光标选择界外。 |
| 2525 | `testInvalidMethod1` | 部分：末尾 `foo()` 调用点可计入 inventory，但错误方法链不给导航目标；光标选择界外。 |
| 2548 | `testInvalidMethod2` | 部分：末尾 `foo()` 调用点可计入 inventory，但错误方法链不给导航目标；光标选择界外。 |
| 2573 | `testInterfaceX` | 已验：显式父类的唯一受保护成员接口在 `implements` 处落到声明文件；通配 import 本身仍不展开。 |
| 2601 | `test306078` | 界外：字段符号代码选择。 |
| 2623 | `testCodeSelectInHybrid1415Projects` | 界外：JDK 或 jar 二进制类型源码解析。 |
| 2662 | `testMethodParameter` | 界外：局部变量或参数符号代码选择。 |
| 2685 | `testConstantInLocal` | 界外：字段符号代码选择。 |

## [ResolveTests2](https://github.com/eclipse-jdt/eclipse.jdt.core/blob/dd2c87485ce2f01b4fc88167f1db701dd6540b35/org.eclipse.jdt.core.tests.model/src/org/eclipse/jdt/core/tests/model/ResolveTests2.java)

| 行 | 测试 | 对照结论 |
| ---: | --- | --- |
| 53 | `testBug227822a` | 界外：JDK 类型或不存在类型的代码选择。 |
| 92 | `testBug227822b` | 界外：JDK 类型或不存在类型的代码选择。 |
| 131 | `testBug227822c` | 界外：JDK 类型或不存在类型的代码选择。 |
| 170 | `testBug227822d` | 界外：JDK 类型或不存在类型的代码选择。 |
| 210 | `testBug232880a` | 界外：二进制 jar 的类路径解析。 |
| 280 | `testBug232880b` | 界外：二进制 jar 的类路径解析。 |
| 350 | `testBug232880c` | 界外：二进制 jar 的类路径解析。 |
| 429 | `testBug232880d` | 界外：二进制 jar 的类路径解析。 |
| 516 | `testBug232880e` | 界外：二进制 jar 的类路径解析。 |
| 619 | `testBug232880f` | 界外：二进制 jar 的类路径解析。 |
| 702 | `testBug232880g` | 界外：二进制 jar 的类路径解析。 |
| 784 | `testBug232880h` | 界外：二进制 jar 的类路径解析。 |
| 867 | `testBug232880i` | 界外：二进制 jar 的类路径解析。 |
| 952 | `testBug232880j` | 界外：二进制 jar 的类路径解析。 |
| 1032 | `testBug249027a` | 界外：不完整或错位包名下的编辑器恢复。 |
| 1078 | `testBug249027b` | 界外：不完整或错位包名下的编辑器恢复。 |
| 1124 | `testBug343693` | 界外：构造器或局部类型的代码选择。 |
| 1166 | `testBug349486` | 界外：JDK MethodHandle 二进制方法绑定。 |
| 1218 | `testBug356325` | 界外：构造器或局部类型的代码选择。 |

## [ASTParserTest](https://github.com/eclipse-jdt/eclipse.jdt.core/blob/dd2c87485ce2f01b4fc88167f1db701dd6540b35/org.eclipse.jdt.core.tests.model/src/org/eclipse/jdt/core/tests/model/ASTParserTest.java)

| 行 | 测试 | 对照结论 |
| ---: | --- | --- |
| 74 | `testKConstants` | 界外：JDT AST 解析器常量或选项，无对应配置事实。 |
| 81 | `testSetting` | 界外：JDT AST 解析器常量或选项，无对应配置事实。 |

可执行的本地证据集中在 `archify/modules/code-analysis/test/extract-java.test.mjs`、`calls-java.test.mjs`、`java-qualified-calls.test.mjs`、`java-projects.test.mjs`。此清单不把 JDT 的非法源码光标恢复、二进制 class-file 解析或工作副本状态改写成 Archify 的事实契约。
