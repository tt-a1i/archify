import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.SourcePositions;
import com.sun.source.util.TreePath;
import com.sun.source.util.TreePathScanner;
import com.sun.source.util.Trees;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import javax.lang.model.element.Element;
import javax.lang.model.element.ExecutableElement;
import javax.lang.model.element.Modifier;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

/** Read-only javac binding oracle for captured Java source. */
public final class SourceBindings {
    private SourceBindings() {}

    private static String field(Object value) {
        return String.valueOf(value).replace('\t', ' ').replace('\r', ' ').replace('\n', ' ');
    }

    private static String relative(Path root, JavaFileObject source) {
        return root.relativize(Path.of(source.toUri()).toAbsolutePath().normalize()).toString().replace('\\', '/');
    }

    // LineMap columns expand tabs; facts use raw UTF-16 offsets in each line.
    private static long column(CompilationUnitTree unit, long offset) {
        long line = unit.getLineMap().getLineNumber(offset);
        return offset - unit.getLineMap().getStartPosition(line) + 1;
    }

    public static void main(String[] args) throws Exception {
        boolean manifestMode = args.length > 0 && args[0].equals("--files");
        if (manifestMode ? args.length < 4 || args.length > 5 : args.length != 4) {
            throw new IllegalArgumentException("usage: SourceBindings <project-root> <source-directories> <out.tsv> <release> | --files <snapshot-root> <base64-path-manifest> <out.tsv> [release]");
        }
        Path root = Path.of(args[manifestMode ? 1 : 0]).toAbsolutePath().normalize();
        Path output = Path.of(args[manifestMode ? 3 : 2]);
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) throw new IllegalStateException("A JDK compiler is required");
        List<Path> files = new ArrayList<>();
        if (manifestMode) {
            for (String encoded : Files.readAllLines(Path.of(args[2]), StandardCharsets.UTF_8)) {
                Path file = root.resolve(new String(Base64.getDecoder().decode(encoded), StandardCharsets.UTF_8)).normalize();
                if (!file.startsWith(root) || !file.toString().endsWith(".java")) throw new IllegalArgumentException("invalid source path in manifest");
                files.add(file);
            }
        } else {
            for (String directory : args[1].split(",")) {
                try (java.util.stream.Stream<Path> paths = Files.walk(root.resolve(directory).normalize())) {
                    paths.filter(file -> file.toString().endsWith(".java")).forEach(files::add);
                }
            }
        }
        List<Path> sourceFiles = files.stream().distinct().sorted().toList();
        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
        long start = System.nanoTime();
        try (StandardJavaFileManager manager = compiler.getStandardFileManager(diagnostics, null, StandardCharsets.UTF_8)) {
            Iterable<? extends JavaFileObject> sources = manager.getJavaFileObjectsFromPaths(sourceFiles);
            List<String> options = new ArrayList<>(List.of("-proc:none", "-Xlint:-options", "-classpath", "", "-sourcepath", ""));
            if (!manifestMode || args.length == 5) {
                options.add("--release");
                options.add(args[manifestMode ? 4 : 3]);
            }
            JavacTask task = (JavacTask) compiler.getTask(null, manager, diagnostics, options, null, sources);
            List<CompilationUnitTree> units = new ArrayList<>();
            for (CompilationUnitTree unit : task.parse()) units.add(unit);
            long parsed = System.nanoTime();
            task.analyze();
            long analyzed = System.nanoTime();
            long errors = diagnostics.getDiagnostics().stream().filter(d -> d.getKind() == Diagnostic.Kind.ERROR).count();
            if (errors != 0) {
                for (Diagnostic<? extends JavaFileObject> problem : diagnostics.getDiagnostics()) {
                    if (problem.getKind() == Diagnostic.Kind.ERROR) System.err.println(problem);
                }
                throw new IllegalStateException(errors + " javac errors; bindings are not an oracle");
            }
            Trees trees = Trees.instance(task);
            SourcePositions positions = trees.getSourcePositions();
            List<String> records = new ArrayList<>();
            for (CompilationUnitTree unit : units) {
                String file = relative(root, unit.getSourceFile());
                String sourceText = unit.getSourceFile().getCharContent(true).toString();
                new TreePathScanner<Void, Void>() {
                    @Override public Void visitMethodInvocation(MethodInvocationTree call, Void ignored) {
                        long first = positions.getStartPosition(unit, call);
                        long last = positions.getEndPosition(unit, call);
                        if (first >= 0 && last >= first && last <= sourceText.length()) {
                            Element element = trees.getElement(getCurrentPath());
                            TreePath declaration = element == null ? null : trees.getPath(element);
                            String targetFile = declaration == null ? "" : relative(root, declaration.getCompilationUnit().getSourceFile());
                            long targetOffset = declaration == null ? -1 : positions.getStartPosition(declaration.getCompilationUnit(), declaration.getLeaf());
                            long targetLine = targetOffset < 0 ? 0 : declaration.getCompilationUnit().getLineMap().getLineNumber(targetOffset);
                            long targetColumn = targetOffset < 0 ? 0 : column(declaration.getCompilationUnit(), targetOffset);
                            boolean isStatic = element != null && element.getModifiers().contains(Modifier.STATIC);
                            String owner = element == null ? "" : element.getEnclosingElement().toString();
                            String method = element instanceof ExecutableElement ? element.getSimpleName().toString() : "";
                            String text = sourceText.substring((int) first, (int) last);
                            records.add(String.join("\t", file,
                                String.valueOf(unit.getLineMap().getLineNumber(first)),
                                String.valueOf(column(unit, first)),
                                String.valueOf(unit.getLineMap().getLineNumber(last)),
                                String.valueOf(column(unit, last)),
                                isStatic ? "static" : "instance",
                                field(owner), field(method), field(targetFile), String.valueOf(targetLine), String.valueOf(targetColumn), field(text)));
                        }
                        return super.visitMethodInvocation(call, ignored);
                    }
                }.scan(unit, null);
            }
            records.sort(Comparator.naturalOrder());
            Files.createDirectories(output.toAbsolutePath().getParent());
            List<String> lines = new ArrayList<>();
            lines.add("file\tline\tcolumn\tendLine\tendColumn\tkind\towner\tmethod\ttargetFile\ttargetLine\ttargetColumn\ttext");
            lines.addAll(records);
            Files.write(output, lines, StandardCharsets.UTF_8);
            long ended = System.nanoTime();
            System.out.printf("jdk=%s files=%d calls=%d parseMs=%.1f analyzeMs=%.1f scanMs=%.1f errors=%d%n",
                System.getProperty("java.version"),
                units.size(), records.size(), (parsed - start) / 1e6, (analyzed - parsed) / 1e6,
                (ended - analyzed) / 1e6, errors);
        }
    }
}
