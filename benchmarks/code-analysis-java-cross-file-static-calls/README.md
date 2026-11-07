# Frozen next Java investigation

Source-first question: at SLF4J 9783320b6c4411a0b120cad9e32cd9a981b1dac2, LoggerFactory.java:454 explicitly calls imported public static Util.getCallingClass, defined in helpers/Util.java:98. Can a developer navigate across that file boundary and recover this known caller? Source hashes, original freeze and a separately disclosed negative-control line transcription correction are retained.

Independent Temurin 17.0.21+9 JavacTask attribution (--release 8 -proc:none) succeeds for 45 API sources with zero compiler errors. It identifies org.slf4j.helpers.Util#getCallingClass(). The interface call iLoggerFactory.getLogger at line427 only identifies ILoggerFactory#getLogger(String), not its runtime implementation. Project methods are not executed. See compiler-attribution.json and the existing code-analysis-java-calls/CallOracle.java helper.

Before any implementation, normal source CLI at preserved team parent 93378351d selects 66 Java files, has no parse errors, and leaves both calls unresolved/unsupported-callee. The static source target is a missed deterministic reference; interface dispatch remains reasonably unknown. This case is source-inspected and a previously used project, not a blind holdout. No new Java capability is validated yet.

Next: freeze reserved wrong-target controls and a real review slice, then implement the bounded explicit class/static path if source/compiler evidence supports it. Keep this independent from Go/Rust implementation layers and preserve original team ancestry.
