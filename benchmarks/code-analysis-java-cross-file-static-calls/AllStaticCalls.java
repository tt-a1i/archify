import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.stream.*;
import javax.tools.*;
import javax.lang.model.element.*;
import com.sun.source.tree.*;
import com.sun.source.util.*;

// Independent supplemental attribution audit; never generates/executes project code.
public class AllStaticCalls {
 static String enc(String value){return Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8));}
 public static void main(String[] args)throws Exception{
  Path root=Path.of(args[0]).toRealPath();JavaCompiler compiler=ToolProvider.getSystemJavaCompiler();
  DiagnosticCollector<JavaFileObject> diagnostics=new DiagnosticCollector<>();
  try(StandardJavaFileManager fm=compiler.getStandardFileManager(diagnostics,null,StandardCharsets.UTF_8)){
   List<Path> files;try(Stream<Path> stream=Files.walk(root)){files=stream.filter(p->p.toString().endsWith(".java")&&!p.getFileName().toString().equals("module-info.java")).sorted().toList();}
   JavacTask task=(JavacTask)compiler.getTask(null,fm,diagnostics,List.of("-proc:none","--release","17","-encoding","UTF-8"),null,fm.getJavaFileObjectsFromPaths(files));
   List<CompilationUnitTree> units=new ArrayList<>();task.parse().forEach(units::add);task.analyze();
   Trees trees=Trees.instance(task);SourcePositions positions=trees.getSourcePositions();
   for(CompilationUnitTree unit:units){String file=root.relativize(Path.of(unit.getSourceFile().toUri())).toString();
    new TreePathScanner<Void,Void>(){
     @Override public Void visitMethodInvocation(MethodInvocationTree call,Void unused){
      Element target=trees.getElement(getCurrentPath());TreePath definition=target==null?null:trees.getPath(target);
      if(target!=null&&target.getKind()==ElementKind.METHOD&&target.getModifiers().contains(Modifier.STATIC)&&definition!=null){
       CompilationUnitTree targetUnit=definition.getCompilationUnit();Path targetPath=Path.of(targetUnit.getSourceFile().toUri());
       long offset=positions.getStartPosition(targetUnit,definition.getLeaf());
       System.out.printf("%s\t%d\t%d\t%s\t%d\t%s%n",enc(file),positions.getStartPosition(unit,call),positions.getEndPosition(unit,call),enc(root.relativize(targetPath).toString()),offset,enc(target.getSimpleName().toString()));
      }
      return super.visitMethodInvocation(call,unused);
     }
    }.scan(unit,null);
   }
   for(var d:diagnostics.getDiagnostics())if(d.getKind()==Diagnostic.Kind.ERROR)System.err.println(d.toString());
   long errors=diagnostics.getDiagnostics().stream().filter(d->d.getKind()==Diagnostic.Kind.ERROR).count();System.err.println("FILES\t"+files.size()+"\tERRORS\t"+errors);
   if(errors>0)System.exit(1);
  }
 }
}
