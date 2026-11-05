import io.shiftleft.semanticcpg.language.*
import java.nio.file.{Files, Paths}

@main def exec(cpgFile: String, out: String, method: String = ".*", mode: String = "methods") = {
  importCpg(cpgFile)
  val selected = cpg.method.fullName(method).l
  val data = selected.map { m =>
    val base = ujson.Obj("id" -> m.id.toString, "name" -> m.name, "fullName" -> m.fullName,
      "file" -> m.filename, "line" -> m.lineNumber.getOrElse(-1))
    if (mode == "cfg") {
      base("nodes") = ujson.Arr.from(m.cfgNode.l.map { n =>
        ujson.Obj("id" -> n.id.toString, "kind" -> n.label, "code" -> n.code,
          "line" -> n.lineNumber.getOrElse(-1),
          "next" -> ujson.Arr.from(n.cfgNext.l.map(_.id.toString)))
      })
    } else if (mode == "calls") {
      base("calls") = ujson.Arr.from(m.call.l.map { n =>
        ujson.Obj("code" -> n.code, "name" -> n.name, "methodFullName" -> n.methodFullName,
          "line" -> n.lineNumber.getOrElse(-1))
      })
    } else if (mode != "methods") throw new IllegalArgumentException("Unknown mode: " + mode)
    base
  }
  Files.writeString(Paths.get(out), ujson.write(ujson.Arr.from(data), indent = 2))
}
