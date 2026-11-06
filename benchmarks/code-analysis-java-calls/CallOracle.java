import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.stream.*;
import javax.tools.*;
import javax.lang.model.element.*;
import com.sun.source.tree.*;
import com.sun.source.util.*;

public class CallOracle {
 static String enc(String s) {return Base64.getEncoder().encodeToString(s.getBytes(StandardCharsets.UTF_8));}
 public static void main(String[] a) throws Exception {
  Path root=Path.of(a[0]), selected=root.resolve(a[1]); boolean attribution=a[2].equals("attribute"); Set<String> names=Set.of(a[3].split(","));
  JavaCompiler compiler=ToolProvider.getSystemJavaCompiler(); DiagnosticCollector<JavaFileObject> ds=new DiagnosticCollector<>();
  try(StandardJavaFileManager fm=compiler.getStandardFileManager(ds,null,StandardCharsets.UTF_8)) {
   List<Path> files;
   if(attribution) try(Stream<Path> stream=Files.walk(root.resolve("slf4j-api/src/main/java"))) {files=stream.filter(p->p.toString().endsWith(".java")&&!p.getFileName().toString().equals("module-info.java")).sorted().toList();}
   else files=List.of(selected);
   JavacTask task=(JavacTask)compiler.getTask(null,fm,ds,List.of("-proc:none","--release","8","-encoding","UTF-8"),null,fm.getJavaFileObjectsFromPaths(files));
   List<CompilationUnitTree> units=new ArrayList<>(); task.parse().forEach(units::add); if(attribution) task.analyze();
   Trees trees=Trees.instance(task); SourcePositions positions=trees.getSourcePositions();
   for(CompilationUnitTree unit:units) if(Path.of(unit.getSourceFile().toUri()).toRealPath().equals(selected.toRealPath())) {
    new TreePathScanner<Void,String>() {
     @Override public Void visitMethod(MethodTree n,String caller) {
      if(!names.contains(n.getName().toString())) return null;
      String name=n.getName().toString(); Element el=trees.getElement(getCurrentPath());
      System.out.printf("M\t%s\t%d\t%d\t%s\t%s%n",name,positions.getStartPosition(unit,n),positions.getEndPosition(unit,n),enc(n.toString()),enc(el==null?"":el.getEnclosingElement()+"#"+el.toString()));
      return super.visitMethod(n,name);
     }
     @Override public Void visitMethodInvocation(MethodInvocationTree n,String caller) {
      if(caller!=null) {Element el=trees.getElement(getCurrentPath()); String target=el==null?"":el.getEnclosingElement()+"#"+el.toString();
       System.out.printf("C\t%s\t%d\t%d\t%s\t%s\t%s%n",caller,positions.getStartPosition(unit,n),positions.getEndPosition(unit,n),enc(n.getMethodSelect().toString()),enc(n.toString()),enc(target));}
      return super.visitMethodInvocation(n,caller);
     }
    }.scan(unit,null);
   }
   for(var d:ds.getDiagnostics()) System.err.println(d.getKind()+"\t"+d.getCode()+"\t"+d.toString().replace('\n',' '));
   System.err.println("FILES\t"+files.size()+"\tERRORS\t"+ds.getDiagnostics().stream().filter(d->d.getKind()==Diagnostic.Kind.ERROR).count());
  }
 }
}
