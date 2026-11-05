import io.shiftleft.semanticcpg.language.*
import io.joern.dataflowengineoss.language.*
import java.nio.file.{Files, Paths}

@main def exec(cpgFile: String, out: String, method: String, parameter: String, call: String) = {
  importCpg(cpgFile)
  if (!cpg.metaData.overlays.l.flatten.contains("ossdataflow")) run.ossdataflow
  def sources = cpg.method.fullName(method).parameter.name(parameter)
  def sinks = cpg.method.fullName(method).call.name(call).argument
  val paths = sinks.reachableByFlows(sources).p.toList
  val status = if (sources.isEmpty || sinks.isEmpty) "empty_selection" else "ok"
  Files.writeString(Paths.get(out), ujson.write(ujson.Obj("status" -> status, "paths" -> ujson.Arr.from(paths),
    "sourceParameters" -> ujson.Arr.from(sources.code.l),
    "sinkArguments" -> ujson.Arr.from(sinks.code.l)), indent = 2))
}
